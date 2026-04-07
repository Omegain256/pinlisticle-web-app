const wpUrl = "https://hairmusings.com";
const user = "admin"; // Placeholder
const pass = "xxxx";  // Placeholder
const b64 = Buffer.from(`${user}:${pass}`).toString('base64');

const endpoint = `${wpUrl.replace(/\/$/, '')}/wp-json/wp/v2/users/me?pin_u=${encodeURIComponent(user)}&pin_p=${encodeURIComponent(pass)}`;

console.log('Sending request to:', endpoint);

fetch(endpoint, {
    method: 'GET',
    headers: {
        'Authorization': `Basic ${b64}`,
        'X-WP-Auth': `Basic ${b64}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    }
})
.then(async r => {
    console.log('Response Status:', r.status);
    const text = await r.text();
    console.log('Response Body Snippet:', text.substring(0, 200));
})
.catch(err => {
    console.error('Fetch Error Name:', err.name);
    console.error('Fetch Error Message:', err.message);
    console.error('Fetch Error Cause:', err.cause);
});
