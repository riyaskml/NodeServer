const express = require("express");
const bodyParser = require("body-parser");
const mysql = require("mysql");
const QRCode = require("qrcode");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const app = express();
const port = process.env.PORT || 3000;
const sha512 = require("js-sha512");
const axios = require("axios");
app.use(cors());
// Configure MySQL database connection

const db = mysql.createConnection({
  host: "localhost",
  user: "root",
  password: "",
  database: "ofai_db",
  connectionLimit: 10,
});

db.connect((err) => {
  if (err) {
    console.error("Error connecting to MySQL:", err);
    return;
  }
  console.log("Connected to MySQL");
});

// Configure middleware
app.use(bodyParser.json());
app.use("/qrcodes", express.static(path.join(__dirname, "qrcodes")));

const generateQRCode = async (registrationId, clientAppUrl) => {
  try {
    const qrCodeData = `${clientAppUrl}/registration/${registrationId}`;
    const qrCodeFilePath = `qrcodes/qrcode_${registrationId}.png`;
    await QRCode.toFile(qrCodeFilePath, qrCodeData);
    return qrCodeFilePath;
  } catch (error) {
    console.error("Error generating and saving QR code:", error);
    return null;
  }
};

// API Endpoint to Fetch Districts
app.get("/api/districts", (req, res) => {
  const query = "SELECT district FROM districts";

  db.query(query, (err, result) => {
    if (err) {
      console.error("Error fetching districts:", err);
      return res
        .status(500)
        .json({ success: false, error: "Internal Server Error" });
    }

    const districts = result.map((row) => row.district);
    return res.status(200).json({ success: true, districts });
  });
});

// API Endpoint to handle form submissions
app.post("/api/saveFormData", async (req, res) => {
  const users = req.body.users;
  const paymentAmount = req.body.amount;

  if (!users || !Array.isArray(users) || users.length === 0) {
    return res.status(400).json({ success: false, error: "Invalid data" });
  }

  // Continue with the save operation
  const query =
    "INSERT INTO users (name, phone, email, district, pincode, days, paymentAmount,qrCodeUrl,paymentStatus) VALUES ?";

  const values = users.map((user) => [
    user.name,
    user.phone,
    user.email,
    user.district === "Other" ? user.customDistrict : user.district,
    user.pincode,
    user.days.join(","),
    paymentAmount,
    null, // Initially set QR code URL to null
    "pending",
  ]);

  db.query(query, [values], async (err, result) => {
    if (err) {
      console.error("Error saving form data:", err);
      return res
        .status(500)
        .json({ success: false, error: "Internal Server Error" });
    }
    const registrationDetails = [];

    for (let i = 0; i < result.affectedRows; i++) {
      const registrationId = result.insertId + i;

      // Generate and save the QR code
      const qrCodePath = await generateQRCode(
        registrationId,
        "https://reg.ofai.org"
      );

      if (!qrCodePath) {
        return res
          .status(500)
          .json({ success: false, error: "Error generating QR code" });
      }

      const updateQrCodeQuery = "UPDATE users SET qrCodeUrl = ? WHERE id = ?";
      db.query(updateQrCodeQuery, [qrCodePath, registrationId], (updateErr) => {
        if (updateErr) {
          console.error("Error updating QR code URL:", updateErr);
          return res
            .status(500)
            .json({ success: false, error: "Internal Server Error" });
        }
      });
      // Add user details to the array
      registrationDetails.push({
        registrationId,
        qrCodeUrl: `/qrcodes/qrcode_${registrationId}.png`,
        name: users[i].name,
        phone: users[i].phone,
        days: users[i].days,
      });
    }
    // Return success response with QR code URL
    return res.status(200).json({
      success: true,
      users: registrationDetails,
      paymentAmount: paymentAmount,
    });
  });
});

// Create the "qrcodes" folder if it doesn't exist
const qrcodesFolderPath = path.join(__dirname, "qrcodes");
if (!fs.existsSync(qrcodesFolderPath)) {
  fs.mkdirSync(qrcodesFolderPath);
}

// API Endpoint to Check Duplicate Mobile Numbers
app.post("/api/checkDuplicateMobileNumbers", async (req, res) => {
  const mobileNumbersToCheck = req.body.mobileNumbers;

  if (
    !Array.isArray(mobileNumbersToCheck) ||
    mobileNumbersToCheck.length === 0
  ) {
    return res.status(400).json({ success: false, error: "Invalid data" });
  }

  // Check if mobile numbers are already registered
  const existingMobileNumbers = await getExistingMobileNumbers();

  const duplicateMobileNumbers = mobileNumbersToCheck.filter((phone) =>
    existingMobileNumbers.includes(phone)
  );

  return res.status(200).json({
    success: true,
    duplicateMobileNumbers,
  });
});

// Function to get existing mobile numbers from the database
const getExistingMobileNumbers = async () => {
  return new Promise((resolve, reject) => {
    const query = "SELECT phone FROM users";

    db.query(query, (err, result) => {
      if (err) {
        console.error("Error fetching existing mobile numbers:", err);
        reject(err);
      } else {
        const mobileNumbers = result.map((row) => row.phone);
        resolve(mobileNumbers);
      }
    });
  });
};

// API Endpoint to fetch user details by mobile number
app.get("/api/userDetailsByMobile/:phone", (req, res) => {
  const phone = req.params.phone;

  // Query the database to get user details by mobile number
  const query = "SELECT name, days, qrCodeUrl FROM users WHERE phone = ?";

  db.query(query, [phone], (err, result) => {
    if (err) {
      console.error("Error fetching user details by mobile number:", err);
      return res
        .status(500)
        .json({ success: false, error: "Internal Server Error" });
    }

    if (result.length === 0) {
      return res.status(404).json({ success: false, error: "User not found" });
    }

    const userDetails = result[0];
    return res.status(200).json({ success: true, userDetails });
  });
});

app.post("/api/initiate_payment", async (req, res) => {
  const paymentData = req.body.SendData;

  try {
    const key = "KIRLHAN0WI";
    const salt_key = "3PCUOFDD7P";
    const txnid = paymentData.txnid;
    const username = "Organics";
    const email = "myofai@gmail.com";
    const amountTotal = paymentData.amount;
    const productinfo = paymentData.productinfo;
    const generateHash = () => {
      const hashstring =
        key +
        "|" +
        txnid +
        "|" +
        amountTotal +
        "|" +
        productinfo +
        "|" +
        username +
        "|" +
        email +
        "|||||||||||" +
        salt_key;
      // Compute SHA-512 hash
      const sha512Hash = sha512.sha512(hashstring);
      return sha512Hash;
    };

    const payload = {
      key: key,
      txnid: txnid,
      amount: parseFloat(amountTotal),
      productinfo: productinfo,
      firstname: username,
      phone: paymentData.phone,
      email: email,
      surl: paymentData.surl,
      furl: paymentData.furl,
      hash: generateHash(),
      udf1: "",
      udf2: "",
      udf3: "",
      udf4: "",
      udf5: "",
      udf6: "",
      udf7: "",
      udf8: "",
      udf9: "",
      udf10: "",
    };
    const options = {
      method: "POST",
      url: "https://pay.easebuzz.in/payment/initiateLink",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      data: payload,
    };

    try {
      const { data } = await axios.request(options);
      res.status(200).json(data);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Error initiating payment" });
    }
  } catch (error) {
    console.error("Error initiating payment:", error);
  }
});

// API endpoint to update payment status
app.post("/api/update_payment_status", (req, res) => {
  const { userId, status } = req.body;

  // Ensure userId and status are provided
  if (!userId || !status) {
    return res
      .status(400)
      .json({ error: "userId and status are required in the request body." });
  }

  // Update the user table with the payment status
  const query = "UPDATE users SET paymentStatus = ? WHERE id = ?";

  db.query(query, [status, userId], (error, results) => {
    if (error) {
      console.error("Error updating payment status:", error);
      return res.status(500).json({ error: "Internal Server Error" });
    }
    res.json({ success: true });
  });
});

// Start the server
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
