snapper2
====
Teambition message server, based on Redis.

### dependencies

- redis

### Enable `nginx ip_hash`: http://socket.io/docs/using-multiple-nodes/

### install

```bash
npm install --production
```

### get servers states

```
http://127.0.0.1:7701/stats?token=eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJuYW1lIjoic25hcHBlciIsImV4cCI6MTQzMTY3MjMzMX0.juk5pMD-SWqQErqL8CwX7zeNtbGFZxtyC710Z7fRpkM
```
其中，`token` 可通过如下方式生成：

```js
var token = snapperProducer.signAuth({name:'snapper'});
```
`{name:'snapper'}` 为必须参数
