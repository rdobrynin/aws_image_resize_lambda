# AWS LAMBDA TO UPLOAD & RESIZE IMAGES WITH SHARP

## USE AWS CLI

1. Zip file
zip -r index.zip *
2. CLI:
 aws lambda update-function-code --function-name [lambda_function] --zip-file fileb://index.zip
 
 example:
 aws lambda update-function-code --function-name sharp_thumbnails --zip-file fileb://index.zip
