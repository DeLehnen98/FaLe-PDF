const S = require('/home/claude/FalePDF/api/_lib/s3.js');
const suite = { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY', region: 'us-east-1', service: 'service' };
const E = S.EMPTY_SHA256;
console.log('get-vanilla', S.signature({ method: 'GET', path: '/', query: [], headers: { host: 'example.amazonaws.com', 'x-amz-date': '20150830T123600Z' }, payloadHash: E }, suite, '20150830T123600Z').signature);
console.log('query-order', S.signature({ method: 'GET', path: '/', query: [['Param2','value2'],['Param1','value1']], headers: { host: 'example.amazonaws.com', 'x-amz-date': '20150830T123600Z' }, payloadHash: E }, suite, '20150830T123600Z').signature);
console.log('post-vanilla', S.signature({ method: 'POST', path: '/', query: [], headers: { host: 'example.amazonaws.com', 'x-amz-date': '20150830T123600Z' }, payloadHash: E }, suite, '20150830T123600Z').signature);
const s3c = { accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', region: 'us-east-1' }; // AWS SigV4 documentation test vector – fale-secret-scan: allow
console.log('s3 get range', S.signature({ method: 'GET', path: '/test.txt', query: [], headers: { host: 'examplebucket.s3.amazonaws.com', range: 'bytes=0-9', 'x-amz-content-sha256': E, 'x-amz-date': '20130524T000000Z' }, payloadHash: E }, s3c, '20130524T000000Z').signature);
const body = 'Welcome to Amazon S3.'; const h = S.sha256hex(body);
console.log('s3 put', S.signature({ method: 'PUT', path: '/' + S.uriEncode('test$file.text', true), query: [], headers: { host: 'examplebucket.s3.amazonaws.com', date: 'Fri, 24 May 2013 00:00:00 GMT', 'x-amz-date': '20130524T000000Z', 'x-amz-storage-class': 'REDUCED_REDUNDANCY', 'x-amz-content-sha256': h }, payloadHash: h }, s3c, '20130524T000000Z').signature);
console.log('s3 list', S.signature({ method: 'GET', path: '/', query: [['max-keys','2'],['prefix','J']], headers: { host: 'examplebucket.s3.amazonaws.com', 'x-amz-content-sha256': E, 'x-amz-date': '20130524T000000Z' }, payloadHash: E }, s3c, '20130524T000000Z').signature);
console.log('s3 presign', S.presign({ method: 'GET', path: '/test.txt', headers: { host: 'examplebucket.s3.amazonaws.com' } }, s3c, 86400, { amzDate: '20130524T000000Z' }).query);
