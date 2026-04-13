const redisConnection = { host: "", port: 0, username: "", password: "", tls: undefined as any };
const REDIS_URL = "rediss://red-cuaomfa3esus73e04tfg:0R2s6V6F1CgN9M8nZ0t@frankfurt-redis.render.com:6379";
try {
    const url = new URL(REDIS_URL);
    redisConnection.host = url.hostname;
    redisConnection.port = url.port ? parseInt(url.port, 10) : (url.protocol === 'rediss:' ? 6380 : 6379);
    if (url.username) redisConnection.username = url.username;
    if (url.password) redisConnection.password = url.password;
    if (url.protocol === 'rediss:') {
        redisConnection.tls = { rejectUnauthorized: false };
    }
} catch (e) {
    console.error(e);
}
console.log(redisConnection);
