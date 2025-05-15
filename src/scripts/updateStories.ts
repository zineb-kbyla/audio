import fs from "fs";
import path from "path";

import { uploadFile } from "../util/s3";

const updateStories = async () => {
  try {
    const jsonFile = fs.readFileSync(
      path.join(__dirname, "../../stories.json")
    );
    await uploadFile("stories.json", jsonFile, "application/json");
    console.log("the stories have been updated successfully");
    process.exit(0);
  } catch (error) {
    console.log("somthing went wrong , we couldn't update the stories");
    process.exit(1);
  }
};

export default updateStories;
