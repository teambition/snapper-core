-- Checkout room' consumers
-- KEYS[1] room key

local consumers = redis.call('hgetall', KEYS[1])
local result = {}

if #consumers == 0 then return result end

for index = 1, #consumers, 2 do
  if consumers[index + 1] == '1' then
    result[#result + 1] = consumers[index]
  else
    -- delete stale consumer
    redis.call('hdel', KEYS[1], consumers[index])
  end
end

if #result == 0 then
  redis.call('del', KEYS[1])
else
  -- update room's expire time
  redis.call('expire', KEYS[1], 172800)
end

return result
