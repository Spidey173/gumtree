const https = require('https');
https.get('https://www.gumtree.com/flats-houses/property-to-rent/uk/england', {
  headers: {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36'
  }
}, (res) => {
  console.log(res.statusCode);
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => console.log('Length:', data.length, 'Title:', data.match(/<title>(.*?)<\/title>/)?.[1]));
}).on('error', console.error);
