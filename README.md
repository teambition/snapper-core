snapper v0.15.0
====
Teambition message service, based on Redis.

[![NPM version][npm-image]][npm-url]
[![Build Status][travis-image]][travis-url]

![snapper-architecture](https://raw.githubusercontent.com/teambition/snapper-core/master/docs/architecture.png)
![snapper-process](https://raw.githubusercontent.com/teambition/snapper-core/master/docs/process.png)

## Snapper-producer https://github.com/teambition/snapper-producer
## Snapper-consumer https://github.com/teambition/snapper-consumer

### dependencies

- redis

### Enable `nginx ip_hash`: http://socket.io/docs/using-multiple-nodes/

### install

```bash
npm install --production
```

### get servers stats

```
http://127.0.0.1:7701/stats?token=eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJuYW1lIjoic25hcHBlciIsImV4cCI6MTQzMTY3MjMzMX0.juk5pMD-SWqQErqL8CwX7zeNtbGFZxtyC710Z7fRpkM
```
其中，`token` 可通过如下方式生成：

```js
var token = snapperProducer.signAuth({name: 'snapper'});
```
`{name: 'snapper'}` 为必须参数

或者直接在 snapper 下运行（确保 config 中的 `tokenSecret` 正确）

```bash
NODE_ENV=production node bin/token
```

[npm-url]: https://npmjs.org/package/snapper-core
[npm-image]: http://img.shields.io/npm/v/snapper-core.svg

[travis-url]: https://travis-ci.org/teambition/snapper-core
[travis-image]: http://img.shields.io/travis/teambition/snapper-core.svg
