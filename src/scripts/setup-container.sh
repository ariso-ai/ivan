#!/bin/sh

# Install packages
apk add --no-cache git openssh

# Setup SSH
mkdir -p /root/.ssh
cp -r "${HOST_HOME}/.ssh"/* /root/.ssh/ 2>/dev/null || true
chmod 600 /root/.ssh/* 2>/dev/null || true
ssh-keyscan -H github.com >> /root/.ssh/known_hosts 2>/dev/null || true

# Setup Claude config (copy only essential files, skip project history)
mkdir -p /root/.claude/plugins
cp "${HOST_HOME}/.claude/settings.json" /root/.claude/ 2>/dev/null || true
cp -r "${HOST_HOME}/.claude/plugins"/* /root/.claude/plugins/ 2>/dev/null || true

# Setup git config
git config --global user.name 'Ivan Agent' 2>/dev/null || true
git config --global user.email 'ivan@agent.local' 2>/dev/null || true

# Install Claude Code
npm i -g @anthropic-ai/claude-code

echo "Container setup complete"

##################################
# Setup API helper
##################################
echo 'echo ${ANTHROPIC_API_KEY}' > /root/.claude/anthropic_key_helper.sh
chmod +x /root/.claude/anthropic_key_helper.sh

ANTHROPIC_API_KEY_LAST_20_CHARS=${ANTHROPIC_API_KEY: -20}
# We write the global config to ~/.claude.json
# Warning this overwrites your existing
cat <<EOM > ~/.claude.json
{
    "customApiKeyResponses": {
        "approved": [ "$ANTHROPIC_API_KEY_LAST_20_CHARS"],
        "rejected": [  ]
    },
    "shiftEnterKeyBindingInstalled": true,
    "theme": "dark" ,
    "hasCompletedOnboarding": true
}
EOM