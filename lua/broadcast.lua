-- Room receive message, then distribute it to it's consumers
-- KEYS[1] room key
-- ARGV[1] message to consumers

local consumers = redis.call('smembers', KEYS[1])
local removed = 0

if #consumers == 0 or ARGV[1] == '' then return '' end

local publishIds = ''

for index = 1, #consumers, 1 do
  if redis.call('rpushx', 'REDIS_PREFIX:L:' .. consumers[index], ARGV[1]) == 0 then
    -- remove stale consumer
    removed = removed + 1
    redis.call('srem', KEYS[1], consumers[index])
  else
    publishIds = publishIds .. ' ' .. consumers[index]
  end
end

if publishIds ~= '' then
  redis.call('publish', 'REDIS_PREFIX:message', publishIds:sub(2))
end

if #consumers == removed then
  -- remove stale room
  redis.call('del', KEYS[1])
else
  -- update room's expire time
  redis.call('expire', KEYS[1], 172800)
end

return 'OK';
