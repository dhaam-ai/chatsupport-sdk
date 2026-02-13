# Chat SDK

> Modern, embeddable chat widget SDK for multi-tenant chat applications.

[![npm version](https://img.shields.io/npm/v/@your-org/chat-sdk.svg)](https://www.npmjs.com/package/@your-org/chat-sdk)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

## Features

- 🎨 **Beautiful UI** - Modern design with light/dark modes
- 🔌 **Real-time** - WebSocket-based messaging
- 🏢 **Multi-tenant** - Full tenant isolation support
- 🤖 **AI + Human** - Seamless bot-to-agent handoff
- ⚡ **Lightweight** - < 30KB gzipped
- 🎯 **TypeScript** - Full type safety
- 🎛️ **Customizable** - Themes, callbacks, features

---

## Installation

```bash
npm install @your-org/chat-sdk
# or
yarn add @your-org/chat-sdk
# or
pnpm add @your-org/chat-sdk
```

---

## Quick Start

### React

```tsx
import { ChatWidget } from '@your-org/chat-sdk';

function App() {
  const user = useCurrentUser(); // Your auth hook

  return (
    <ChatWidget
      config={{
        serviceUrl: 'https://chat-api.example.com',
        tenantId: 'acme-corp',
        appId: 'web-widget',
        token: user.chatToken, // JWT from your backend
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
        },
      }}
    />
  );
}
```

### HTML/Vanilla JS

```html
<script src="https://cdn.example.com/chat-sdk.umd.js"></script>
<script>
  ChatSDK.init({
    serviceUrl: 'https://chat-api.example.com',
    tenantId: 'acme-corp',
    appId: 'web-widget',
    token: 'your-jwt-token',
    user: {
      id: 'user-123',
      name: 'John Doe',
      email: 'john@example.com',
    },
  });
</script>
```

---

## Getting a Token

The SDK requires a JWT token from your chat backend. Your backend should:

1. Authenticate the user (via your auth system)
2. Request a widget token from the chat service
3. Return the token to your frontend

**Backend Example (Node.js):**

```javascript
// Your backend route
app.post('/api/chat/token', async (req, res) => {
  // Verify user is authenticated
  const user = req.user;

  // Request token from chat service
  const response = await fetch('https://chat-api.example.com/api/v1/widget/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      appId: 'web-widget',
      userId: user.id,
      userName: user.name,
      userEmail: user.email,
    }),
  });

  const { data } = await response.json();
  res.json({ token: data.token });
});
```

**Frontend Example:**

```javascript
async function getChatToken() {
  const response = await fetch('/api/chat/token', {
    method: 'POST',
    credentials: 'include',
  });
  const { token } = await response.json();
  return token;
}
```

---

## Configuration

### Full Configuration Options

```typescript
interface ChatSDKConfig {
  /** Chat service URL */
  serviceUrl: string;

  /** Your tenant ID */
  tenantId: string;

  /** Your app ID */
  appId: string;

  /** JWT token */
  token: string;

  /** User information */
  user: {
    id: string;
    name: string;
    email?: string;
    avatar?: string;
    metadata?: Record<string, unknown>;
  };

  /** Theme customization */
  theme?: {
    primaryColor?: string;
    headerBackground?: string;
    headerText?: string;
    customerBubbleColor?: string;
    agentBubbleColor?: string;
    fontFamily?: string;
    borderRadius?: string;
    position?: 'bottom-right' | 'bottom-left';
    welcomeMessage?: string;
    darkMode?: boolean;
  };

  /** Feature toggles */
  features?: {
    fileUpload?: boolean;
    emoji?: boolean;
    typing?: boolean;
    sound?: boolean;
    showHeader?: boolean;
    autoExpand?: boolean;
    showTimestamps?: boolean;
  };

  /** Event callbacks */
  callbacks?: {
    onMessage?: (message: ChatMessage) => void;
    onStatusChange?: (status: ChatStatus, mode: ChatMode) => void;
    onAgentJoined?: (agentId: string, agentName: string) => void;
    onAgentLeft?: (agentId: string) => void;
    onSessionClosed?: () => void;
    onError?: (error: Error) => void;
    onConnected?: (sessionId: string) => void;
    onDisconnected?: (reason: string) => void;
  };

  /** Enable debug logging */
  debug?: boolean;
}
```

---

## Theming Examples

### Corporate Blue

```tsx
<ChatWidget
  config={{
    ...baseConfig,
    theme: {
      primaryColor: '#2563eb',
      headerBackground: '#1e40af',
      headerText: '#ffffff',
      customerBubbleColor: '#3b82f6',
      position: 'bottom-right',
      welcomeMessage: 'Welcome to ACME Support!',
    },
  }}
/>
```

### Modern Purple (Dark Mode)

```tsx
<ChatWidget
  config={{
    ...baseConfig,
    theme: {
      primaryColor: '#8b5cf6',
      headerBackground: 'linear-gradient(135deg, #7c3aed 0%, #c084fc 100%)',
      borderRadius: '24px',
      darkMode: true,
    },
  }}
  darkMode
/>
```

### Minimalist

```tsx
<ChatWidget
  config={{
    ...baseConfig,
    theme: {
      primaryColor: '#000000',
      fontFamily: '"Inter", sans-serif',
      borderRadius: '8px',
    },
    features: {
      showHeader: false,
      emoji: false,
    },
  }}
/>
```

---

## Custom UI (Headless Mode)

For complete control over the UI, use the hooks directly:

```tsx
import { ChatProvider, useChat } from '@your-org/chat-sdk';

// Your custom chat UI
function CustomChatUI() {
  const { state, actions } = useChat();
  const [input, setInput] = useState('');

  const handleSend = async () => {
    if (!input.trim()) return;
    await actions.sendMessage(input);
    setInput('');
  };

  return (
    <div className="my-chat-container">
      {/* Connection status */}
      <div className="status">
        {state.connected ? '🟢 Online' : '🔴 Offline'}
        {state.session?.mode === 'HUMAN' && ` • Agent: ${state.session.assignedAgentName}`}
      </div>

      {/* Messages */}
      <div className="messages">
        {state.messages.map((msg) => (
          <div key={msg.id} className={`message ${msg.senderType.toLowerCase()}`}>
            <span className="sender">{msg.senderName || msg.senderType}</span>
            <p>{msg.content}</p>
            <time>{new Date(msg.timestamp).toLocaleTimeString()}</time>
          </div>
        ))}

        {state.isTyping && (
          <div className="typing-indicator">
            {state.typingUser} is typing...
          </div>
        )}
      </div>

      {/* Input */}
      {state.session?.status !== 'CLOSED' && (
        <div className="input-area">
          <input
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              actions.startTyping();
            }}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            placeholder="Type a message..."
          />
          <button onClick={handleSend} disabled={state.loading}>
            Send
          </button>
        </div>
      )}

      {/* Actions */}
      <div className="actions">
        {state.session?.mode === 'BOT' && (
          <button onClick={() => actions.requestAgent('Customer requested')}>
            Talk to Human
          </button>
        )}
        <button onClick={actions.closeSession}>End Chat</button>
      </div>
    </div>
  );
}

// Wrap with provider
function App() {
  return (
    <ChatProvider config={config}>
      <CustomChatUI />
    </ChatProvider>
  );
}
```

---

## Direct WebSocket Client

For non-React or advanced use cases:

```typescript
import { ChatWebSocketClient } from '@your-org/chat-sdk';

// Create client
const client = new ChatWebSocketClient({
  serviceUrl: 'https://chat-api.example.com',
  tenantId: 'acme-corp',
  appId: 'web-widget',
  token: 'your-jwt-token',
  user: {
    id: 'user-123',
    name: 'John Doe',
  },
  debug: true,
});

// Register event handlers
client.on('message', (message) => {
  console.log('New message:', message);
});

client.on('agentJoined', ({ agentId, agentName }) => {
  console.log(`${agentName} joined the chat`);
});

client.on('statusChange', ({ mode, status }) => {
  console.log('Status:', status, 'Mode:', mode);
});

client.on('error', (error) => {
  console.error('Chat error:', error);
});

// Connect
try {
  const session = await client.connect();
  console.log('Connected to session:', session.id);
} catch (error) {
  console.error('Failed to connect:', error);
}

// Send messages
await client.sendMessage('Hello!');

// Request human agent
await client.requestAgent('I need help with billing');

// Typing indicators
client.startTyping();
// ... user types ...
client.stopTyping();

// Get history
const messages = await client.getHistory(50);

// Close session
await client.closeSession();

// Disconnect
client.disconnect();
```

---

## Event Reference

### Messages

```typescript
interface ChatMessage {
  id: string;
  chatSessionId: string;
  senderType: 'CUSTOMER' | 'AGENT' | 'BOT' | 'SYSTEM';
  senderId?: string;
  senderName?: string;
  content: string;
  messageType: 'TEXT' | 'SYSTEM' | 'FILE' | 'IMAGE';
  timestamp: Date;
  metadata?: Record<string, unknown>;
}
```

### Session States

| Status | Mode | Description |
|--------|------|-------------|
| `OPEN` | `BOT` | Chatting with AI bot |
| `WAITING_FOR_AGENT` | `HUMAN` | In queue for agent |
| `ASSIGNED` | `HUMAN` | Agent is active |
| `CLOSED` | - | Session ended |

### Callbacks

| Callback | When Fired |
|----------|------------|
| `onConnected` | WebSocket connected, session ready |
| `onMessage` | New message received |
| `onStatusChange` | Session status or mode changed |
| `onAgentJoined` | Human agent joined |
| `onAgentLeft` | Human agent left |
| `onSessionClosed` | Session was closed |
| `onError` | Error occurred |
| `onDisconnected` | WebSocket disconnected |

---

## TypeScript Support

Full TypeScript support included:

```typescript
import {
  ChatWidget,
  ChatSDKConfig,
  ChatMessage,
  ChatSession,
  ChatMode,
  ChatStatus,
  useChat,
  ChatWebSocketClient,
} from '@your-org/chat-sdk';

const config: ChatSDKConfig = {
  serviceUrl: 'https://chat-api.example.com',
  tenantId: 'acme-corp',
  appId: 'web-widget',
  token: 'jwt-token',
  user: {
    id: 'user-123',
    name: 'John Doe',
  },
};
```

---

## Browser Support

| Browser | Version |
|---------|---------|
| Chrome | 60+ |
| Firefox | 55+ |
| Safari | 11+ |
| Edge | 79+ |
| Mobile Safari | 11+ |
| Chrome Android | 60+ |

---

## Troubleshooting

### Connection Failed

1. Check `serviceUrl` is correct
2. Verify JWT token is valid and not expired
3. Ensure CORS allows your origin
4. Check WebSocket port (usually 3001)

### Messages Not Appearing

1. Verify you're in the correct session room
2. Check WebSocket connection status
3. Enable debug mode to see events

### Token Expired

Implement token refresh:

```typescript
const config: ChatSDKConfig = {
  // ...
  callbacks: {
    onError: async (error) => {
      if (error.message.includes('expired')) {
        const newToken = await refreshToken();
        // Reconnect with new token
      }
    },
  },
};
```

---

## Contributing

1. Fork the repository
2. Create your feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

---

## License

MIT © Your Organization
