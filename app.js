const express = require("express");
const app = express();
var cors = require("cors");
const { MongoClient, GridFSBucket, ObjectId } = require("mongodb");

const multer = require("multer");
const { Readable } = require("stream");
const Busboy = require("busboy");
// const { response } = require("express");

let storage = multer.memoryStorage();
let upload = multer({ storage: storage });

require("dotenv").config();
// middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// app.use(cors());
app.options("*", cors());

// app.options("*", (req, res) => {
//   res.header({
//     "Access-Control-Allow-Origin": "*",
//     "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
//     "Access-Control-Allow-Headers": "Content-Type",
//   });
//   res.end();
// });

// Database connection

const connectionString = process.env.MONGO_URI;


const client = new MongoClient(connectionString, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

const connectDB = async () => {
  try {
    await client.connect();
    const db = client.db("HumbleDonations");
    console.log("Connected to db...");
    return db;
  } catch (error) {
    console.log(error);
  }
};

const getCities = async () => {
  const db = await connectDB();
  let cityList = [];
  const allcollections = await (
    await db.listCollections().toArray()
  ).map((item) => {
    if (
      item.name !== "productImages.files" &&
      item.name !== "productImages.chunks" &&
      item.name !== "donor"
    )
      cityList.push(item.name);
    // console.log(item.name);
  });
  // console.log(cityList);
  return cityList;
};

const insertData = async (data, collectionName) => {
  try {
    const db = await connectDB();
    const donorData = db.collection(collectionName);
    const result = await donorData.insertOne(data);
    console.log(`inserted ${result.insertedCount} entries`);
  } catch (error) {
    console.log(error);
  }
};

const findDonor = async (prop, collectionName) => {
  try {
    const db = await connectDB();
    const donor = db.collection(collectionName);
    const result = await donor.findOne({ uid: prop });
    // console.log(donor);
    return result;
  } catch (error) {
    console.log(error);
  }
};

const findSingleDonor = async (uid) => {
  try {
    const response = await findDonor(`${uid}`, "donor");
    if (response === null) {
      console.log("Data not Found", response);
      return { status: 0 };
    }
    const cities = await response.cities;
    // console.log(cities);
    const products = [];
    for (let i = 0; i < cities.length; i++) {
      const donatedItem = await findDonor(uid, cities[i]);
      products.push(...donatedItem.products);
    }
    // console.log("Products are", products);
    return { status: 1, products };
  } catch (error) {
    console.log(error);
  }
};

const updateDonorCities = async (data) => {
  try {
    const { uid, city } = data;
    const db = await connectDB();
    const donorData = db.collection("donor");
    const result = await donorData.updateOne(
      { uid: uid },
      { $push: { cities: city } },
    );
    // console.log(`Update response ${result}`);
  } catch (e) {
    console.log("Donor Cities update Error", e);
  }
};

const postPhotos = async () => {
  try {
    const db = await connectDB();
    const bucket = new GridFSBucket(db, {
      bucketName: "productImages",
    });
    // console.log(bucket);
    return bucket;
  } catch (e) {
    console.log("Post photos", e);
  }
};

const updateData = async (data) => {
  const { uid, productId, productName, address, photoIDs, city, postcode } =
    data;
  try {
    const db = await connectDB();
    const donorData = db.collection(city);
    const result = await donorData.updateOne(
      { uid: uid },
      {
        $push: {
          products: {
            productId,
            productName,
            address,
            photos: photoIDs,
            donated: { status: false, name: "", uid: "" },
            requests: [],
            city,
            postcode,
          },
        },
      },
    );
    // console.log(`Update response ${result.modifiedCount}`);
  } catch (e) {
    console.log("Update data error", e);
  }
};

const putRequest = async (data) => {
  try {
    const { donoruid, doneeuid, city, productId } = data;
    // console.log("donee uid", doneeuid);
    // console.log("index value", productId);
    const db = await connectDB();
    const donorData = db.collection(city);
    const updateQuery = {
      $push: { "products.$.requests": { doneeuid, status: "pending" } },
    };
    const result = await donorData.updateOne(
      { uid: donoruid, "products.productId": ObjectId(productId) },
      updateQuery,
    );
    // console.log(`Modified ${result.modifiedCount} records`);
    return `Modified ${result.modifiedCount} records`;
  } catch (error) {
    console.log(error);
  }
};

const deleteItem = async (data) => {
  try {
    const { photos } = data;
    const db = await connectDB();
    const collection = db.collection(data.city);
    const response = await collection.updateOne(
      { uid: data.uid },
      {
        $pull: { products: { productId: ObjectId(data.productId) } },
      },
    );

    const bucket = await postPhotos();

    for (let i = 0; i < bucket.length; i++) {
      bucket.delete(
        ObjectId(photos[i], (err) => {
          if (err) {
            console.log(`Error while deleting ${photos[i]} : ${err}`);
          }
          console.log(`Deleted photo id : ${photos[i]}`);
        }),
      );
      console.log(`deleted ${photos[i]}`);
    }
    console.log(`Delete Item: Modified ${response.modifiedCount} records`);
    return response.modifiedCount;
  } catch (error) {
    console.log(error);
    return 0;
  }
};

const acceptRequest = async (data) => {
  try {
    const db = await connectDB();
    const collection = db.collection(data.city);
    console.log(data);
    const response = await collection.updateOne(
      { uid: data.donoruid, "products.productId": ObjectId(data.productId) },
      {
        $set: { "products.$.donated": { status: true, uid: data.doneeuid } },
      },
    );
    console.log(response);

    return { status: 1, modifiedCount: response.modifiedCount };
  } catch (error) {
    console.log(error);
    return { status: 0 };
  }
};

const findDonorsData = async (collectionName) => {
  try {
    const db = await connectDB();
    const donor = db.collection(collectionName);
    let products = [];

    await donor.find().forEach((doc) => {
      products.push({
        uid: doc.uid,
        products: doc.products,
      });
    });

    return { status: 1, products: products };
  } catch (error) {
    console.log(error);
    return { status: 0 };
  }
};

const deletRequest = async (data) => {
  try {
    const db = await connectDB();
    const collection = db.collection(data.city);
    console.log(data);
    const response = await collection.updateOne(
      { uid: data.uid, "products.productId": ObjectId(data.productId) },
      {
        $pull: { "products.$.requests": { doneeuid: data.doneeuid } },
      },
    );
    console.log(`Deleted request : ${response.modifiedCount} records modified`);
    return { status: 1, ModifiedCount: response.modifiedCount };
  } catch (error) {
    console.log(error);
    return { status: 0 };
  }
};

app.get("/donorGetRequest/:uid", async (req, res) => {
  const { uid } = req.params;
  // console.log(uid);
  try {
    const response = await findSingleDonor(uid);
    res
      .status(200)
      .set({
        "Access-Control-Allow-Origin": "*",
      })
      .json(response);
  } catch (error) {
    console.log(error);
    res
      .status(500)
      .set({ "Access-Control-Allow-Origin": "*" })
      .json({ status: 0 });
  }
});

app.delete("/deleteItem", (req, res) => {
  console.log(req.body);
  deleteItem(req.body).then((response) => {
    console.log(response);
    res
      .status(200)
      .set({
        "Access-Control-Allow-Origin": "*",
      })
      .json({ count: response });
  });
});

app.get("/getPhoto/:photoId", async (req, res) => {
  const { photoId } = req.params;
  // console.log(photoId);
  const bucket = await postPhotos();

  let buff = [];

  const downloadStream = await bucket.openDownloadStream(ObjectId(photoId));
  // console.log(downloadStream, "hello");
  downloadStream.on("data", (chunk) => {
    buff.push(chunk);
  });
  downloadStream.on("error", (error) => {
    console.log(error, "*****download stream*****");
    res
      .set(500)
      .set({
        "Access-Control-Allow-Origin": "*",
      })
      .json({ status: 0 });
  });
  downloadStream.on("end", () => {
    res
      .set(200)
      .set({
        "Access-Control-Allow-Origin": "*",
      })
      .json({ status: 1, photoBuffer: buff });
  });
});

app.post("/acceptRequest", (req, res) => {
  acceptRequest(req.body).then((response) => {
    res
      .status(200)
      .set({
        "Access-Control-Allow-Origin": "*",
      })
      .json(response);
  });
});

app.post("/sendRequest", async (req, res) => {
  const response = await putRequest(req.body);
  // console.log(response);
  res.status(200).json({ status: response });
});

app.post("/uploadImages", async (req, res) => {
  const busboy = Busboy({ headers: req.headers });
  var metadata = {};
  var photoIDs = [];
  try {
    let bucket = await postPhotos();
    req.pipe(busboy);
    busboy.on("file", (fieldname, file, filename, encoding, mimetype) => {
      // console.log(fieldname);
      let uploadStream = bucket.openUploadStream(filename);
      photoIDs.push(uploadStream.id);
      file.pipe(uploadStream);
    });
    busboy.on("field", (fieldname, value) => {
      metadata[fieldname] = value;
    });
    busboy.on("finish", async () => {
      // console.log("photos", photoIDs);
      const { uid, productName, address, city, postcode } = metadata;
      const count = await findDonor(uid, "donor");
      if (count) {
        // console.log(count);
        let booli = false;
        for (let i = 0; i < count.cities.length; i++) {
          if (count.cities[i] === city) {
            booli = true;
          }
        }
        // console.log(photoIDs[0]);
        if (booli) {
          const newData = {
            uid,
            productId: photoIDs[0],
            productName,
            address,
            photoIDs,
            city,
            postcode,
          };
          // console.log("update data");
          updateData(newData);
        } else {
          // console.log("New City added");
          const cityanduid = { city, uid };
          await updateDonorCities(cityanduid);
          const newData = {
            uid,
            products: [
              {
                productId: photoIDs[0],
                productName,
                address,
                photos: photoIDs,
                donated: { status: false, uid: "" },
                requests: [],
                city,
                postcode,
              },
            ],
          };
          await insertData(newData, city);
        }
      } else {
        const donor = {
          uid,
          cities: [city],
        };
        await insertData(donor, "donor");
        const newData = {
          uid,
          products: [
            {
              productId: photoIDs[0],
              productName,
              address,
              photos: photoIDs,
              donated: { status: false, uid: "" },
              requests: [],
              city,
              postcode,
            },
          ],
        };
        await insertData(newData, city);
      }
      res
        .set({ "Access-Control-Allow-Origin": "*" })
        .status(200)
        .json({ msg: "Upload finished", status: true });
    });
  } catch (e) {
    console.log(e);
    res
      .set({ "Access-Control-Allow-Origin": "*" })
      .status(500)
      .json({ msg: "Server error try again", status: false });
  }
});

// Charity page
app.get("/getCharityRequest/:city", async (req, res) => {
  const { city } = req.params;
  const response = await findDonorsData(city);
  res.set({ "Access-Control-Allow-Origin": "*" }).status(200).json(response);
});

app.delete("/deleteRequest", (req, res) => {
  deletRequest(req.body).then((response) => {
    res.set({ "Access-Control-Allow-Origin": "*" }).status(200).json(response);
  });
});

app.get("/getCitiesList", async (req, res) => {
  const response = await getCities();
  res.set({ "Access-Control-Allow-Origin": "*" }).status(200).json(response);
});

const port = 5000;

app.listen(port, () => {
  console.log(`Listening on port: ${port}`);
});
