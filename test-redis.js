const { URL } = require('url');
const urlStr = 'rediss://red-cuaomfa3esus73e04tfg:0R2s6V6F1CgN9M8nZ0t@frankfurt-redis.render.com:6379';
const url = new URL(urlStr);
console.log(url.port);
