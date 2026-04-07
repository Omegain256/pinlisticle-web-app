const url = "https://hairmusings.com/wp-json/wp/v2/users/me";
fetch(url, {
    method: 'GET',
    headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    }
}).then(async r => {
    console.log('Status:', r.status);
    console.log(await r.text());
}).catch(e => {
    console.log('Error name:', e.name);
    console.log('Error message:', e.message);
    console.log('Error cause:', e.cause);
});
