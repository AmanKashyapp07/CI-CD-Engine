const crypto = require("crypto");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });
// this file acts as github push event simulator to test the webhook handler in the backend. it constructs a mock payload that mimics the structure of a real GitHub push event, including fields like "after" for the latest commit hash and "repository" with details about the repository being pushed to. it then calculates the HMAC signature using the secret from the environment variable (if set) and sends a POST request to the webhook endpoint with the appropriate headers and payload. this allows us to verify that the webhook handler is correctly receiving and processing the event, handling both cases - with and without signature - to ensure robustness in different scenarios.
const webhookUrl = "http://localhost:5001/api/webhooks/github";
const secret = process.env.GITHUB_WEBHOOK_SECRET || ""; // Optional secret matching .env

const payload = {
  after: "87c9bc3da38f12a80693aef4c78d59ad02a6c1e3", // Fake commit hash
  repository: {
    name: "magnus-test-2",
    clone_url: "https://github.com/amankashyap/magnus-test-2",
  },
}; // this payload contains after and repository fields which are required for the webhook handler to process the event, after means the latest commit hash and repository contains the name and clone_url of the repository which are used to trigger the build process. commit hash is fake and does not need to exist in the actual repository since this is just a test payload to verify that the webhook handler is correctly receiving and processing the event. actually commit hash means the latest commit hash of the branch which is being pushed to, but since this is just a test payload we can use any fake commit hash to trigger the webhook handler and verify that it is correctly processing the event and triggering the build process.

const payloadString = JSON.stringify(payload);
// payload will be hashed using the secret and sent in the X-Hub-Signature-256 header for signature verification in the webhook handler. if secret is not set, then the payload will be sent without signature and the webhook handler should handle this case gracefully by checking if the signature header is present and valid before processing the event. this allows us to test both cases - with and without signature - to ensure that the webhook handler is robust and can handle different scenarios correctly. it is important because in real scenarios, the secret may not always be set or may be misconfigured, and we want to ensure that our webhook handler can still function correctly without crashing or throwing errors when the signature is missing or invalid.
// Calculate signature if secret is present
const headers = {
  "Content-Type": "application/json",
  "X-GitHub-Event": "push",
}; // content type is set to application/json so that the webhook handler can parse the payload as JSON and X-GitHub-Event is set to push to indicate that this is a push event from GitHub and should be processed as such.

if (secret) {
  const hmac = crypto.createHmac("sha256", secret); // 
  const digest = "sha256=" + hmac.update(payloadString).digest("hex");
  headers["X-Hub-Signature-256"] = digest; // attach the calculated signature in the headers if secret is present, otherwise send without signature
  console.log("Calculated signature:", digest);
} else {
  console.log("No GITHUB_WEBHOOK_SECRET env variable. Sending signature-less payload.");
} // if secret is not set, then the payload will be sent without signature and the webhook handler should handle this case gracefully by checking if the signature header is present and valid before processing the event. this allows us to test both cases - with and without signature - to ensure that the webhook handler is robust and can handle different scenarios correctly. it is important because in real scenarios, the secret may not always be set or may be misconfigured, and we want to ensure that our webhook handler can still function correctly without crashing or throwing errors when the signature is missing or invalid.  

console.log("Sending mock push webhook event to:", webhookUrl);

fetch(webhookUrl, {
  method: "POST",
  headers: headers, // attach the calculated signature in the headers if secret is present, otherwise send without signature
  body: payloadString, // send the payload as a JSON string in the body of the request so that the webhook handler can parse it and extract the necessary information to trigger the build process based on the push event. this allows us to test that the webhook handler is correctly receiving and processing the payload and triggering the build process as expected when a push event occurs.
})
  .then(async (res) => {
    console.log("Response Status:", res.status);
    const body = await res.json(); 
    console.log("Response Body:", body);
  })
  .catch((err) => {
    console.error("Fetch error:", err);
  });


