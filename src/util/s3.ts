import S3 from "aws-sdk/clients/s3";

const accessKeyId = process.env.AWS_ACCESS_KEY!;
const secretAccessKey = process.env.AWS_SECRET_KEY!;
const Bucket = process.env.AWS_BUCKET!;
const region = process.env.AWS_REGION!;

export const s3 = new S3({
  accessKeyId,
  secretAccessKey,
  region,
});

export const uploadFile = async (
  fileKey: string,
  file: S3.Body,
  ContentType: string
) => {
  try {
    if (!file || (file instanceof Buffer && file.length === 0)) {
      console.error("❌ Le fichier est vide.");
      return null;
    }

    const data = await s3
      .upload({
        Bucket,
        Key: fileKey,
        Body: file,
        ACL: "public-read",
        ContentType,
      })
      .promise(); // Assurez-vous que .promise() est disponible

    console.log(`✅ Fichier uploadé avec succès : ${data.Location}`);
    return data.Location;
  } catch (error) {
    console.error("❌ Erreur lors de l'upload sur S3 :", error);
    throw error;
  }
};

export const deleteFile = async (fileKey: string) => {
  try {
    await s3
      .deleteObject({
        Bucket,
        Key: fileKey,
      })
      .promise();

    console.log(`✅ Fichier supprimé avec succès : ${fileKey}`);
    return true;
  } catch (error) {
    console.error(`❌ Erreur lors de la suppression du fichier S3 (${fileKey}) :`, error);
    throw new Error('S3 delete failed'); // Lancer une erreur au lieu de retourner false
  }
}; 