const B2 = require('backblaze-b2');
const fs = require('fs');

const b2 = new B2({
  applicationKeyId: '005caa48da9fe940000000002',
  applicationKey: 'K005lndZxi/tzxsiQIGJiZ19ThPXQ7g',
});

const authorizeB2 = async () => {
  await b2.authorize();
};

const uploadToB2 = async (localFilePath, fileName, bucketId) => {
  await authorizeB2();

  const { data: { uploadUrl, authorizationToken } } = await b2.getUploadUrl({ bucketId });
  const fileData = fs.readFileSync(localFilePath);

  const res = await b2.uploadFile({
    uploadUrl,
    uploadAuthToken: authorizationToken,
    fileName,
    data: fileData,
  });

  return res.data.fileId;
};
/*
    // Now you can save the grouped files to your database or move them to permanent storage
        const uploadedFiles = {};
        const bucketId = "bcda0a54188d4af99f6e0914"
        // Loop through each platform and its files
        for (const platform in groupedFiles) {
            const platformFiles = groupedFiles[platform];
            uploadedFiles[platform] = [];
    
            // Loop through each file in the platform's array
            for (const file of platformFiles) {
                const { originalname, path } = file;
                const fileName = `${platform}/${originalname}`;
    
                // Upload file to Backblaze
                try {
                    const fileId = await uploadToB2(path, fileName, bucketId);
                    uploadedFiles[platform].push({ originalname, fileId });
                } catch (error) {
                    console.error(`Failed to upload ${originalname} to ${platform}:`, error);
                }
            }
        }
    
        return uploadedFiles;
*/
module.exports = {
  b2,
  authorizeB2,
  uploadToB2,
};
