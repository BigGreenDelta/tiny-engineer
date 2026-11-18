#!/usr/bin/with-contenv bashio
export TE_ROBOT_URL="$(bashio::config 'robot_url')"
export TE_ROBOT_TOKEN="$(bashio::config 'robot_token')"
export TE_STATE_TTL_S="$(bashio::config 'state_ttl_s')"
export TE_ATTENTION_REPEAT_S="$(bashio::config 'attention_repeat_s')"
export TE_ATTENTION_MAX_S="$(bashio::config 'attention_max_s')"
export TE_BROKER_PORT=8790
exec node /app/bin/tiny-engineer-broker.js
