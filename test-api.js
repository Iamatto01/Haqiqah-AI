const https = require('http');

const data = JSON.stringify({
  url: "https://www.astroawani.com/berita-politik/tamat-kerjasama-dengan-bersatu-pas-mungkin-keluar-atau-dikeluarkan-daripada-pn-penganalisis",
  source: "api"
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

const req = https.request(options, (res) => {
  let body = '';
  res.on('data', (chunk) => body += chunk.toString());
  res.on('end', () => {
    try {
        const parsed = JSON.parse(body);
        console.log("=== FACT CHECK RESULTS ===\n");
        if (parsed.success) {
            console.log(`Verdict: ${parsed.data.truthMeter.icon} ${parsed.data.truthMeter.label}`);
            console.log(`Confidence Score: ${parsed.data.confidenceScore}/100\n`);
            console.log(`Summary:\n${parsed.data.analysis.summary}\n`);
            console.log(`Extracted Claims:`);
            parsed.data.claims.forEach((c, i) => console.log(`  ${i+1}. ${c.claim}`));
        } else {
            console.log(parsed);
        }
    } catch(e) {
        console.log("Raw response:", body);
    }
  });
});

req.on('error', (error) => {
  console.error('Error connecting to backend:', error);
});

req.write(data);
req.end();
