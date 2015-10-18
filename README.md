Snapper：Teambition 分布式消息推送系统
====
Teambition push messaging service, based on redis.

[![NPM version][npm-image]][npm-url]
[![Build Status][travis-image]][travis-url]

[Snapper](https://github.com/teambition/snapper-core) 是 Teambition 开源的一个运行于 Node.js 环境的分布式消息推送系统。不同于 [kafka](https://github.com/apache/kafka)、[RabbitMQ](https://github.com/rabbitmq/rabbitmq-server)、[ActiveMQ](https://github.com/apache/activemq)，Snapper 主要用于向浏览器端、移动端推送实时消息，目前正用于 Teambition Web 端消息推送。

### Snapper 主要特点

1. 使用 JavaScript 开发，运行于 Node.js 环境；
2. 消息队列池、状态数据池基于 Redis，支持 Redis cluster；
3. 支持分布式部署，利用 `nginx ip_hash` 可在同一台机器中开启多个进程，利用 LVS 等负载均衡可以开启多台机器；
4. 消息消费者 Consumer 客户端链接基于 Engine.IO 开发，使用 websocket 协议，自动重连，自动读取消息，可支持 Android、iOS 客户端；
5. 消息生产者 Producer 客户端基于 TCP 开发，内置消息队列，自动重连，确保消息发送到 Broker 服务器；
6. 基于 [JSON-RPC 2.0](http://jsonrpc.org/specification) 协议，确保消息按序推送，推送成功且仅推送一次；
7. 消息缓存机制，消费者断线重连后消息会自动送达（不会丢失），缓存时间可自定义，默认为 24 小时；
8. 基于 Room 广播消息，即同一个消息可以分发给在同一个 Room 中的多个消费者；
9. 同样基于 Room，对于同一个目标用户，支持建立多个消费链接，如同一份消息可以同时往多个浏览器窗口，或各个移动端推送；
10. 实时统计用户在线状态（即同一用户当前建立了多少个消费链接）。

### Snapper 构成

#### Snapper 由四部分组成：

1. [snapper-core](https://github.com/teambition/snapper-core) 消息 Broker，服务器端，用于与 consumer 端建立长连接，接收 producer 端生产的消息，并将消息分发到 consumers。
2. [Snapper-producer](https://github.com/teambition/snapper-producer) 消息 Producer，API 客户端，API 通过它往 Broker 推送消息。
3. [Snapper-consumer](https://github.com/teambition/snapper-consumer) 消息 Consumer，用户客户端，与 Broker 建立消息长连接并接收消息。
4. Redis 服务。

![snapper-architecture](https://raw.githubusercontent.com/teambition/snapper-core/master/docs/architecture.png)

![snapper-process](https://raw.githubusercontent.com/teambition/snapper-core/master/docs/process.png)

### Enable `nginx ip_hash`: http://socket.io/docs/using-multiple-nodes/

### install

```bash
git clone https://github.com/teambition/snapper-core.git
cd snapper-core
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
