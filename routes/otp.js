const jwt = require("jsonwebtoken");
const moment = require("moment");
const { sendOTP } = require("../functions/nodemailer");
const { generate } = require("../functions/otp");
const { OTP, validateOtp, validateOtpVerification } = require("../models/otp");
const { User } = require("../models/user");
const { getPasswordResetLink } = require("../functions/auth");

const router = require("express").Router();

router.post("/", async (req, res, next) => {
  const { email, type } = req.body;
  const { error } = validateOtp({ email, type });
  if (error) return res.status(400).send(error.details[0].message);

  //is user available with this email
  const user = await User.findOne({ email: email });
  if (!user) return res.status(400).send("no such user with this email");

  //generate otp
  const otp = generate();

  //putting otp in database
  const otpDoc = new OTP({ otp });
  await otpDoc.save();

  //creating encrypted details to send
  const otpDetails = {
    otpId: otpDoc._id,
    email,
    type,
  };

  const encoded = jwt.sign(otpDetails, process.env["JWT_KEY"]);

  //sending the mail
  try {
    const result = await sendOTP({
      otp,
      to: email,
      type,
    });
    res.send({ status: "success", details: encoded, result });
  } catch (error) {
    res.status(500).send({ status: "failure", error });
  }
});

router.post("/verify/", async (req, res, next) => {
  const { otp, key, email } = req.body;
  const { error } = validateOtpVerification({ otp, key, email });
  if (error) return res.status(400).send(error.details[0].message);

  let otpDetails;
  try {
    otpDetails = jwt.verify(key, process.env["JWT_KEY"]);
  } catch (err) {
    res.status(400).details("wrong key provided");
  }

  //email checking
  if (!otpDetails.email == email)
    return res.status(400).send("wrong email provided");

  //geting otp doc from db and validating
  const otpDoc = await OTP.findOne({ _id: otpDetails.otpId });
  if (!otpDoc) return res.status(400).send("otp is wrong or expired");
  if (otpDoc.isVerified) return res.status(400).send("otp already verified");

  //isCorectOtp provided
  if (otpDoc.otp != otp) return res.status(400).send("wrong otp provided");

  //updating the otp -- isVerified to true
  await OTP.updateOne(
    { _id: otpDetails.otpId },
    { $set: { isVerified: true } }
  );

  // doing and sending response based on type
  if (otpDetails.type === "verify") {
    const { n, nModified } = await User.updateOne(
      { email: otpDetails.email },
      { $set: { isEmailVerified: true } }
    );
    if (nModified === 1)
      return res.send({ status: "success", isEmailVerified: true });
    else if (n === 1) {
      return res.send("It is already verified");
    }
  } else if (otpDetails.type === "login") {
    const user = await User.findOne({ email: otpDetails.email });
    const token = user.generateAuthToken();
    return res.send({ status: "success", token });
  } else if (otpDetails.type == "reset") {
    const resetLink = await getPasswordResetLink(otpDetails.email);
    res.send({ status: "success", resetLink });
  }
});

module.exports = router;
