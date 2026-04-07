const https = require('https');
https.get('https://hairmusings.com/wp-json/wp/v2/users/me', (res) => {
    console.log('Status Code:', res.statusCode);
    console.log('Headers:', res.headers);
});
