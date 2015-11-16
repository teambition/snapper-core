Snapper：Teambition 分布式消息推送系统
====
Teambition push messaging service, based on redis.

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

从下面的结构图可以看出，我们可以建立 redis cluster 数据池，运行多个 snapper-core 进程来提升负载量。而 snapper-core 集群通过内网负载均衡服务对 snapper-producers 提供统一接口，通过外网负载均衡服务对 snapper-consumers 提供统一接口。因此 snapper-core 对 snapper-producer 和 snapper-consumer 而言均变成了一项“无上限”服务资源。同时由于 snapper-producer 和 snapper-consumer 内置的自动重连和缓存机制，snapper-core 服务的内部资源调整如版本更新、服务扩展等能确保对外提供稳定服务，数据不会丢失。

![snapper-architecture](https://raw.githubusercontent.com/teambition/snapper-core/master/docs/architecture.png)

### 服务流程

Snapper 服务的基本流程如下：

1. 启动 snapper-core 服务；
2. API 服务通过 snapper-producer 对 snapper-core 发起 TCP 长连接，并进行身份验证；
3. 用户客户端向 API 请求 token，snapper-producer 生成 token 给用户，用户用 token 对 snapper-core 发起 websocket 长连接；
4. 用户客户端向 API 请求订阅相关 room，API 验证用户权限后通过 snapper-producer 转发请求给 snapper-core，从而用户与 room 建立关系；
5. API 通过 snapper-producer 往 snapper-core 的各个 room 推送消息，snapper-core 从 redis 读取 room 与用户的关系，从而把发给该 room 的消息分发给 room 内用户。

![snapper-process](https://raw.githubusercontent.com/teambition/snapper-core/master/docs/process.png)

### 系统运行

这里以一个简单的 demo 示意如何运行该消息系统。

1. 下载并启动 snapper-core

```sh
git clone https://github.com/teambition/snapper-core.git
cd snapper-core
npm install --production
# 假设 redis 已启动，我们调整 config/production.json 中的相关参数
# 我们使用 pm2，以 production 模式启动进程
pm2 start process/production.json
# 让我们看看是否成功运行！
pm2 ls
```

2. API 服务启用 snapper-producer

先安装 snapper-producer：
```sh
npm i --save snapper-producer
```

再配置 snapper-producer：
```js
var Producer = require('snapper-producer')
// 相关配置说明参考 https://github.com/teambition/snapper-producer
var producer = new Producer(7800, 'http://127.0.0.1', {
  producerId: 'testProducerId',
  secretKeys: ["tokenXXXXXXX"]
})
// producer 会自动与 snapper-core 发起连接并认证
```

用户请求 token，API 为其生成 token：
```js
// 这里 userId 是必须参数，是真正识别用户的凭证
var token = producer.signAuth({userId: 'userIdxxx'})
```

用户请求加入一个 room，API 验证其具有权限后，让他加入 room：
```js
producer.joinRoom(
  'projects/51762b8f78cfa9f357000011', // 这是 teambition 的一个项目，抽象为一个 room
  'lkoH6jeg8ATcptZQFHHH7w~~', // 这是用户连接到 snapper-core 获得的一个 consumerId
  function (err, res) {
    /*...*/
    // 响应结果给用户
  }
)
```

API 往 room 推送消息：
```js
producer.sendMessage(
  'projects/51762b8f78cfa9f357000011', // 上面示意的 room
  '{"e":":remove:tasks","d":"553f569aca14974c5f806a01"}' // 字符串消息，这里是 Teambition 约定的消息格式
)
// snapper 并没有限定消息具体格式，只要是字符串即可，完全由 snapper-producer 和 snapper-consumer 相互约定
```

3. 用户客户端启用 snapper-consumer：

先安装 snapper-consumer：
```sh
npm i --save snapper-consumer
```
或：
```sh
 bower i --save snapper-consumer
```

这里是 Teambition web 端的源码，我们对 snapper-consumer 进行了一层简单的封装 `lib/socket.coffee`：

```coffee
define((require, exports, module) ->

  teambition = require('teambition')
  Backbone   = require('backbone')
  Consumer   = require('consumer')
  http       = require('lib/http-thunks')

  class SocketClient extends Consumer

    onopen: ->
      console.info('--- WebSocket Opend ---') if teambition.env is 'development'

    onmessage: (event) ->
      # 使用 json-rpc
      if event.type isnt 'request'
        # 非法消息类型，通常不应该有
        return @onerror(new Error('It is not a request: ' + JSON.stringify(event.data)))

      # 一次推送可能包含 1~20 条消息，所以这里是一个消息数组
      while event.data.params.length
        try
          # 每一条消息都是一个 json string
          data = JSON.parse(event.data.params.shift())
          if data and typeof data.e is 'string'
            # parse 出来后通过 backbone 的事件机制 trigger 出去，各种相关事件监听者会得到自己关心的数据
            @trigger(data.e, data.d)
          else
            @onerror(new Error('Unprocessable entity: ' + JSON.stringify(data)))
        catch err
          @onerror(err)

    _join: (room, consumerId) ->
      # 因为加入到 room 是向 API 服务发起请求，经过 API 验证权限后才能真正加入到 room
      # 所以 _join 方法才是真正的 join room 逻辑实现，这里是通过 ajax 请求到 API
      http.post("#{room}/subscribe", {consumerId: consumerId})()

  _.extend(SocketClient.prototype, Backbone.Events)

  return new SocketClient()
)
```

上面封装成模块后，再初始化：
```coffee
socketClient = require('lib/socket')
socketClient.connect('https://push.teambition.com', {
  path: '/websocket'
  token: 'snapperTokenxxxxxx'
})
```

### 横向扩展机制

#### Enable `nginx ip_hash`: http://socket.io/docs/using-multiple-nodes/

### 单用户多消费者机制

### 消息保证机制

### 用户在线状态机制

### 服务状态

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
