// dependencies
const async = require('async');
const AWS = require('aws-sdk');
const gm = require('gm').subClass({ imageMagick: true });
const sharp = require('sharp');
const fetch = require('node-fetch');

// constants

const SIZES = [
  process.env.SMALL_SIZE, //small
  process.env.MEDIUM_SIZE, //medium
  process.env.SMALL_X3_SIZE, //small-x3
  process.env.MEDIUM_X3_SIZE //medium-x3
];

// get reference to S3 client
const s3 = new AWS.S3();

exports.handler = (event, context, callback) => {

  const srcBucket = process.env.IMAGE_BUCKET_SRC;
  const srcKey = event.Records[0].s3.object.key;
  const dstBucket = process.env.IMAGE_BUCKET_OUTPUT;

  // Infer the image type.
  const typeMatch = srcKey.match(/\.([^.]*)$/);
  if (!typeMatch) {
    console.error('unable to infer image type for key ' + srcKey);
    return context.done();
  }
  const imageType = typeMatch[1];
  if (imageType !== "jpg" && imageType !== "png" && imageType !== "gif") {
    console.log('skipping non-image ' + srcKey);
    return context.done();
  }

  // Sanity check: validate that source and destination are different buckets.
  if (srcBucket === dstBucket) {
    console.error("Destination bucket must not match source bucket.");
    return context.done();
  }

  // Download the image from S3
  s3.getObject({
        Bucket: srcBucket,
        Key: srcKey
      },
      (err, response) => {

        if (err)
          return console.error('unable to download image ' + err);

        const contentType = response.ContentType;

        const original = gm(response.Body);
        original.size((err, size) => {

          if (size.width >= size.height) {
            SIZES.push(size.width);
          } else {
            SIZES.push(size.height)
          }

          if (err)
            return console.error(err);

          //transform, and upload to a different S3 bucket.
          async.each(SIZES,
              (max_size, callback) => {

                resize_photo(size, max_size, imageType, original, srcKey, dstBucket, contentType, response, callback);
              },
              (err) => {
                let options = {
                  method: 'POST',
                  data: {
                    guid: 'foo',
                    valid: false
                  },
                  headers: {"Content-Type": "application/json; charset=utf-8" }
                };

                if (err) {
                  options.data.valid = false;
                  console.error('Unable to resize ' + srcBucket + ' due to an error: ' + err);
                } else {
                  console.log(
                      'Successfully resized ' + srcBucket
                  );
                }

                let path = srcKey.split('/');
                let envKey = path[0];

                let envApirl;

                switch (envKey) {
                  case "qa_v2":
                    envApirl = "http://dev-lb-qa-rest.hellomobil.ee/hm/";
                    break;
                  case "prod":
                  case "prod-temp":
                    envApirl = "https://prod-lb-rest.hellomobil.ee/hm/";
                    break;
                  default:
                    envApirl = "http://dev-lb-dev-rest.hellomobil.ee/hm/";
                }

                fetch(envApirl + "util/process_image_status", options)
                    .then(res => res.json()) // parse response as JSON (can be res.text() for plain response)
                    .then(response => {
                      console.log("=====Response From Success Callback fetch method");
                      console.log(response);
                      // here you do what you want with response
                    })
                    .catch(err => {
                      console.log("=====Response From Error Callback fetch method");
                      console.log(err);
                    });

                context.done();
              });
        });
      });
};

const resize_photo = (size, max_size, imageType, original, srcKey, dstBucket, contentType, response, done) => {

  let path = srcKey.split('/');
  let fileName = path[path.length - 1];

  let i;
  let outpuPath = "";
  for (i = 0; i < (path.length - 1); i++) {
    outpuPath += path[i] + "/"
  }

  let original_flag = false;

  if (max_size !== process.env.SMALL_SIZE && max_size !== process.env.MEDIUM_SIZE
      && max_size !== process.env.SMALL_X3_SIZE && max_size !== process.env.MEDIUM_X3_SIZE) {
    outpuPath += "original" + "/" + fileName;
    original_flag = true;

    max_size = (size.width >= size.height) ? size.width : size.height;

  } else {
    outpuPath += max_size + "/" + fileName;
  }

  let dstKey = decodeURIComponent(outpuPath.replace(/\+/g, " "));

  // transform, and upload to a different S3 bucket.
  async.waterfall([

        transform = (next) => {

          let scaleFactor = (size.width > size.height) ? max_size / size.height : max_size / size.width;

          let targetWidth = size.width * scaleFactor;
          let targetHeight = size.height * scaleFactor;

          if (original_flag) {
            targetWidth = size.width;
            targetHeight = size.height;
          }

          // Transform the image buffer in memory.
          sharp(response.Body)
              .resize(parseInt(targetWidth), parseInt(targetHeight))
              .sharpen()
              .jpeg({
                quality: 80,
                progressive: true,
                chromaSubsampling: '4:4:4',
                trellisQuantisation: true,
                overshootDeringing: true,
                optimiseCoding: true,
                optimiseScans: true
              })
              .toBuffer(imageType, (err, buffer) => {

                if (err) {
                  next(err);
                } else {
                  next(null, buffer);
                }
              });
        },
        upload = (data, next) => {
          // Stream the transformed image to a different S3 bucket.
          s3.putObject({
                Bucket: dstBucket,
                Key: dstKey,
                Body: data,
                ACL: 'public-read',
                ContentType: contentType
              },
              next);
        },

      ], (err) => {

        console.log('finished resizing ' + dstBucket + '/' + dstKey);

        if (err) {
          console.error(err)
          ;
        } else {
          console.log(
              'Successfully resized ' + dstKey
          );
        }

        done(err);
      }
  );
};