Snapper：Teambition 分布式消息推送系统
====
Teambition push messaging service, based on redis.

[![NPM version][npm-image]][npm-url]
[![Build Status][travis-image]][travis-url]
[![js-standard-style][js-standard-image]][js-standard-url]

[Snapper](https://github.com/teambition/snapper-core) 是 Teambition 开源的一个运行于 Node.js 环境的分布式消息推送系统。不同于 [kafka](https://github.com/apache/kafka)、[RabbitMQ](https://github.com/rabbitmq/rabbitmq-server)、[ActiveMQ](https://github.com/apache/activemq)，Snapper 主要用于向浏览器端、移动端推送实时消息，目前正用于 Teambition Web 端消息推送，可以通过 https://push.teambition.com/ 查看当前运行的版本。

### Snapper 主要特点

1. 使用 JavaScript 开发，运行于 Node.js 环境；
2. 消息队列池、状态数据池基于 Redis，并使用 lua 脚本进行核心操作，特别高效；同时支持 Redis cluster，可以随着用户负载量横向扩展；
3. 分布式部署，利用 `nginx ip_hash` 可在同一台机器中运行多个进程，利用 LVS 等负载均衡可以运行于多台机器，可以随着用户负载量横向扩展；
4. 消息消费者 Consumer 客户端链接基于 Engine.IO 开发，使用 websocket 协议，自动重连，自动读取消息，另可支持 Android、iOS 客户端，；
5. 消息生产者 Producer 客户端基于 TCP 开发，内置消息队列，自动重连，确保消息发送到 Broker 服务器；
6. 基于 [JSON-RPC 2.0](http://jsonrpc.org/specification) 协议，确保消息按序推送，推送成功且仅推送一次；
7. 消息缓存机制，消费者断线重连后消息会自动送达（不会丢失），缓存时间可自定义，默认为 24 小时；
8. 基于 Room 广播消息，即同一个消息可以分发给在同一个 Room 中的多个消费者；
9. 同样基于 Room，对于同一个目标用户，支持建立多个消费链接，同一个消息可以同时推送到同一个用户的多个浏览器窗口，或各个移动端；
10. 实时统计用户在线状态：即时查询同一用户当前建立了多少个消费链接；
11. 客户端身份验证机制，Consumer 和 Producer 发起连接时都需要通过 token 验证身份。

相关特征细节见下文。

### 系统构成

Snapper 由四部分组成：

1. [snapper-core](https://github.com/teambition/snapper-core) 消息 broker，服务器端，消息系统的核心，与 producer 端建立 TCP 长连接接收 API 服务生产的消息，它与 consumer 端建立 websocket 长连接分发推送消息。
2. [snapper-producer](https://github.com/teambition/snapper-producer) 消息 producer，API 客户端，API 服务通过 producer 往 Brokers 推送消息。并为 consumer 端提供身份验证服务和 room 订阅服务。
3. [snapper-consumer](https://github.com/teambition/snapper-consumer) 消息 consumer，用户客户端，consumer 从 producer 获取 token，然后与 broker 建立长连接，并通过 producer 订阅相关 room，就能接收 producer 发送到 room 的消息。
4. Redis 服务，用于保存 rooms 和 consumers 的关系状态信息，也为每一个 consumer 建立消息缓存队列。

### 服务流程

Snapper 服务的基本流程如下：

1. 启动 snapper-core 服务；
2. API 服务通过 snapper-producer 对 snapper-core 发起 TCP 长连接，并进行身份验证；
3. 用户客户端向 API 请求 token，snapper-producer 生成 token 给用户，用户用 token 对 snapper-core 发起 websocket 长连接；
4. 用户客户端向 API 请求订阅相关 room，API 验证用户权限后通过 snapper-producer 转发请求给 snapper-core，从而用户与 room 建立关系；
5. API 通过 snapper-producer 往 snapper-core 的各个 room 推送消息，snapper-core 从 redis 读取 room 与用户的关系，从而把发给该 room 的消息分发给 room 内用户。

### [更多文档](https://github.com/teambition/snapper-core/blob/master/docs/snapper.md)


[npm-url]: https://npmjs.org/package/snapper-core
[npm-image]: http://img.shields.io/npm/v/snapper-core.svg

[travis-url]: https://travis-ci.org/teambition/snapper-core
[travis-image]: http://img.shields.io/travis/teambition/snapper-core.svg

[js-standard-url]: https://github.com/feross/standard
[js-standard-image]: https://img.shields.io/badge/code%20style-standard-brightgreen.svg?style=flat
