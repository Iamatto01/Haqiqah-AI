const http = require('http');

const data = JSON.stringify({
  text: "The Earth is actually flat and scientists are hiding the truth from us. NASA faked the moon landings to maintain their massive budget and keep people compliant. The ice wall at the edge of the world is guarded by international military forces."
});

const options = {
  hostname: 'localhost',
  port: 3000,
  path: '/api/v1/verify-content',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': data.length
  }
};

const req = http.request(options, (res) => {
  let body = '';
  res.on('data', (chunk) => {
    body += chunk;
  });
  res.on('end', () => {
    console.log(`STATUS: ${res.statusCode}`);
    console.log('RESPONSE:');
    console.log(JSON.stringify(JSON.parse(body), null, 2));
  });
});

req.on('error', (e) => {
  console.error(`Problem with request: ${e.message}`);
});

req.write(data);
req.end();
