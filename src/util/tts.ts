import polly from "aws-sdk/clients/polly";

const accessKeyId = process.env.AWS_ACCESS_KEY!;
const secretAccessKey = process.env.AWS_SECRET_KEY!;
const region = process.env.AWS_REGION!;

const tts = new polly({
  credentials: { accessKeyId, secretAccessKey },
  region,
});

export default tts;
