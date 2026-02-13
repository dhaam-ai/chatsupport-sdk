# Chat SDK Integration Guide

A React/Next.js compatible chat widget SDK for integrating customer support chat into your application.

---

## Table of Contents

1. [Installation](#installation)
2. [Quick Start](#quick-start)
3. [Configuration](#configuration)
4. [React Integration](#react-integration)
5. [Next.js Integration](#nextjs-integration)
6. [Customization](#customization)
7. [Advanced Usage](#advanced-usage)
8. [API Reference](#api-reference)
9. [Troubleshooting](#troubleshooting)

---

## Installation

```bash
npm install @chat-service/sdk
# or
yarn add @chat-service/sdk
# or
pnpm add @chat-service/sdk
```

### Peer Dependencies

The SDK requires React 17+ as a peer dependency:

```bash
npm install react react-dom
```

---

## Quick Start

### Basic Usage

```tsx
import { ChatWidget } from '@chat-service/sdk';

function App() {
  return (
    <ChatWidget
      config={{
        serviceUrl: 'https://api.chat.example.com',
        tenantId: 'your-tenant-id',
        appId: 'your-app-id',
        token: userCognitoToken,
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

That's it! A chat bubble will appear in the bottom-right corner of your page.

---

## Configuration

### ChatSDKConfig

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `serviceUrl` | `string` | ✅ | Chat service backend URL |
| `tenantId` | `string` | ✅ | Your tenant ID (from registration) |
| `appId` | `string` | ✅ | Your app ID (from registration) |
| `token` | `string` | ✅ | Cognito JWT token from your auth |
| `user` | `object` | ✅ | Current user info |
| `user.id` | `string` | ✅ | User's unique ID |
| `user.name` | `string` | ✅ | User's display name |
| `user.email` | `string` | ❌ | User's email |
| `theme` | `ChatTheme` | ❌ | UI customization |
| `features` | `ChatFeatures` | ❌ | Feature toggles |
| `callbacks` | `ChatCallbacks` | ❌ | Event handlers |

### Full Example

```tsx
import { ChatWidget, type ChatSDKConfig } from '@chat-service/sdk';

const chatConfig: ChatSDKConfig = {
  // Required
  serviceUrl: process.env.NEXT_PUBLIC_CHAT_SERVICE_URL!,
  tenantId: 'acme-corp',
  appId: 'support-widget',
  token: auth.accessToken,
  user: {
    id: auth.user.id,
    name: auth.user.name,
    email: auth.user.email,
  },

  // Theme customization
  theme: {
    primaryColor: '#007bff',
    headerBackground: '#007bff',
    headerText: '#ffffff',
    customerBubbleColor: '#007bff',
    agentBubbleColor: '#f0f0f0',
    fontFamily: 'Inter, sans-serif',
    borderRadius: '16px',
    position: 'bottom-right',
  },

  // Feature toggles
  features: {
    fileUpload: true,
    emoji: true,
    typing: true,
    sound: true,
    showHeader: true,
    autoExpand: false,
  },

  // Event callbacks
  callbacks: {
    onConnected: (sessionId) => {
      console.log('Connected to session:', sessionId);
    },
    onMessage: (message) => {
      console.log('New message:', message);
    },
    onAgentJoined: (agentId, agentName) => {
      console.log(`Agent ${agentName} joined`);
    },
    onStatusChange: (status, mode) => {
      console.log('Status changed:', status, mode);
    },
    onError: (error) => {
      console.error('Chat error:', error);
    },
  },
};

function App() {
  return <ChatWidget config={chatConfig} defaultOpen={false} />;
}
```

---

## React Integration

### With Auth Context

```tsx
// ChatSupport.tsx
import { ChatWidget } from '@chat-service/sdk';
import { useAuth } from './AuthContext';

export function ChatSupport() {
  const { user, token, isAuthenticated } = useAuth();

  // Don't render until authenticated
  if (!isAuthenticated || !token) {
    return null;
  }

  return (
    <ChatWidget
      config={{
        serviceUrl: process.env.REACT_APP_CHAT_SERVICE_URL!,
        tenantId: process.env.REACT_APP_TENANT_ID!,
        appId: process.env.REACT_APP_APP_ID!,
        token: token,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
        },
        theme: {
          primaryColor: '#6366f1',
        },
      }}
    />
  );
}
```

### In App Root

```tsx
// App.tsx
import { ChatSupport } from './ChatSupport';
import { AuthProvider } from './AuthContext';

function App() {
  return (
    <AuthProvider>
      <Router>
        <Routes>
          {/* Your routes */}
        </Routes>
        <ChatSupport />
      </Router>
    </AuthProvider>
  );
}
```

---

## Next.js Integration

### App Router (Next.js 13+)

```tsx
// components/ChatSupport.tsx
'use client';

import { ChatWidget } from '@chat-service/sdk';
import { useAuth } from '@/hooks/useAuth';

export function ChatSupport() {
  const { user, accessToken } = useAuth();

  if (!accessToken || !user) {
    return null;
  }

  return (
    <ChatWidget
      config={{
        serviceUrl: process.env.NEXT_PUBLIC_CHAT_SERVICE_URL!,
        tenantId: process.env.NEXT_PUBLIC_TENANT_ID!,
        appId: process.env.NEXT_PUBLIC_APP_ID!,
        token: accessToken,
        user: {
          id: user.sub,
          name: user.name,
          email: user.email,
        },
      }}
    />
  );
}
```

```tsx
// app/layout.tsx
import { ChatSupport } from '@/components/ChatSupport';

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        {children}
        <ChatSupport />
      </body>
    </html>
  );
}
```

### Pages Router

```tsx
// pages/_app.tsx
import type { AppProps } from 'next/app';
import dynamic from 'next/dynamic';
import { useAuth } from '@/hooks/useAuth';

// Dynamic import to avoid SSR issues
const ChatWidget = dynamic(
  () => import('@chat-service/sdk').then((mod) => mod.ChatWidget),
  { ssr: false }
);

export default function App({ Component, pageProps }: AppProps) {
  const { user, token } = useAuth();

  return (
    <>
      <Component {...pageProps} />
      {user && token && (
        <ChatWidget
          config={{
            serviceUrl: process.env.NEXT_PUBLIC_CHAT_SERVICE_URL!,
            tenantId: process.env.NEXT_PUBLIC_TENANT_ID!,
            appId: process.env.NEXT_PUBLIC_APP_ID!,
            token: token,
            user: {
              id: user.id,
              name: user.name,
              email: user.email,
            },
          }}
        />
      )}
    </>
  );
}
```

### With AWS Amplify Auth

```tsx
import { ChatWidget } from '@chat-service/sdk';
import { useAuthenticator } from '@aws-amplify/ui-react';
import { fetchAuthSession } from 'aws-amplify/auth';
import { useEffect, useState } from 'react';

export function ChatSupport() {
  const { user, authStatus } = useAuthenticator();
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    async function getToken() {
      if (authStatus === 'authenticated') {
        const session = await fetchAuthSession();
        setToken(session.tokens?.accessToken?.toString() ?? null);
      }
    }
    getToken();
  }, [authStatus]);

  if (authStatus !== 'authenticated' || !token) {
    return null;
  }

  return (
    <ChatWidget
      config={{
        serviceUrl: process.env.NEXT_PUBLIC_CHAT_SERVICE_URL!,
        tenantId: process.env.NEXT_PUBLIC_TENANT_ID!,
        appId: process.env.NEXT_PUBLIC_APP_ID!,
        token: token,
        user: {
          id: user.userId,
          name: user.username,
          email: user.signInDetails?.loginId ?? '',
        },
      }}
    />
  );
}
```

---

## Customization

### Theme Options

```tsx
const theme = {
  // Colors
  primaryColor: '#007bff',        // Main brand color
  headerBackground: '#007bff',    // Header background
  headerText: '#ffffff',          // Header text color
  customerBubbleColor: '#007bff', // Customer message bubbles
  agentBubbleColor: '#e9ecef',    // Agent/bot message bubbles

  // Typography
  fontFamily: 'Inter, system-ui, sans-serif',

  // Shape
  borderRadius: '12px',           // Widget border radius

  // Position
  position: 'bottom-right',       // or 'bottom-left'
};
```

### Feature Toggles

```tsx
const features = {
  fileUpload: true,    // Show file upload button
  emoji: true,         // Show emoji picker
  typing: true,        // Show typing indicators
  sound: true,         // Enable notification sounds
  showHeader: true,    // Show header with status
  autoExpand: false,   // Auto-expand widget on load
};
```

### Custom Styling with CSS

Override the default styles by targeting the widget container:

```css
/* Custom styles */
#chat-sdk-widget .chat-header {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
}

#chat-sdk-widget .message-bubble.customer {
  background: #667eea;
}

#chat-sdk-widget .send-button {
  background: #667eea;
}
```

---

## Advanced Usage

### Using Hooks

For more control, use the provided hooks:

```tsx
import {
  ChatProvider,
  useChat,
  useChatMessages,
  useChatSession,
  useChatActions,
} from '@chat-service/sdk';

function CustomChatUI() {
  const { state } = useChat();
  const messages = useChatMessages();
  const session = useChatSession();
  const { sendMessage, requestAgent } = useChatActions();

  const handleSend = () => {
    sendMessage('Hello!');
  };

  const handleEscalate = () => {
    requestAgent('Need human assistance');
  };

  return (
    <div>
      <div>Status: {session?.status}</div>
      <div>Mode: {session?.mode}</div>

      <div>
        {messages.map((msg) => (
          <div key={msg.id}>
            <strong>{msg.senderType}:</strong> {msg.content}
          </div>
        ))}
      </div>

      <button onClick={handleSend}>Send</button>
      <button onClick={handleEscalate}>Talk to Human</button>
    </div>
  );
}

function App() {
  return (
    <ChatProvider config={chatConfig}>
      <CustomChatUI />
    </ChatProvider>
  );
}
```

### Direct Client Usage

For non-React applications:

```typescript
import { ChatWebSocketClient } from '@chat-service/sdk';

const client = new ChatWebSocketClient({
  serviceUrl: 'https://api.chat.example.com',
  tenantId: 'your-tenant',
  appId: 'your-app',
  token: userToken,
  user: { id: 'user-1', name: 'John' },
});

// Connect
const session = await client.connect();
console.log('Connected to session:', session.id);

// Subscribe to messages
client.on('message', (message) => {
  console.log('New message:', message);
});

// Send message
client.sendMessage('Hello!');

// Disconnect when done
client.disconnect();
```

---

## API Reference

### ChatWidget Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `config` | `ChatSDKConfig` | Required | Configuration object |
| `defaultOpen` | `boolean` | `false` | Start with widget expanded |

### Hooks

#### useChat()

Returns full context including state, actions, and config.

```tsx
const { state, actions, config } = useChat();
```

#### useChatMessages()

Returns array of chat messages.

```tsx
const messages: ChatMessage[] = useChatMessages();
```

#### useChatSession()

Returns current session state.

```tsx
const session: ChatSession | null = useChatSession();
```

#### useChatActions()

Returns action functions.

```tsx
const {
  sendMessage,
  startTyping,
  stopTyping,
  closeSession,
  requestAgent,
  reconnect,
} = useChatActions();
```

#### useChatState()

Returns full SDK state.

```tsx
const state: ChatSDKState = useChatState();
```

### Types

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

interface ChatSession {
  id: string;
  mode: 'BOT' | 'HUMAN';
  status: 'OPEN' | 'WAITING_FOR_AGENT' | 'ASSIGNED' | 'CLOSED';
  assignedAgentId?: string;
  assignedAgentName?: string;
}

interface ChatSDKState {
  initialized: boolean;
  connected: boolean;
  loading: boolean;
  session: ChatSession | null;
  messages: ChatMessage[];
  isTyping: boolean;
  typingUser?: string;
  error: Error | null;
}
```

---

## Troubleshooting

### Widget not appearing

1. Check that you have valid `token`, `tenantId`, and `appId`
2. Verify the user is authenticated before rendering the widget
3. Check browser console for connection errors

### CORS errors

Ensure your frontend URL is added to the `allowedOrigins` for your app:

```http
PATCH /api/v1/tenants/:tenantId/apps/:appId
{
  "allowedOrigins": ["https://your-frontend.com"]
}
```

### "Invalid token" error

1. Verify your Cognito configuration in the tenant settings
2. Check that the token hasn't expired
3. Ensure the token is from the correct Cognito user pool

### Messages not sending

1. Check WebSocket connection status: `useChatState().connected`
2. View browser Network tab for WebSocket frame errors
3. Ensure the backend WebSocket server is running on port 3001

### Next.js SSR Errors

Use dynamic import with `ssr: false`:

```tsx
const ChatWidget = dynamic(
  () => import('@chat-service/sdk').then((mod) => mod.ChatWidget),
  { ssr: false }
);
```

### TypeScript errors

Ensure you have the correct types installed:

```bash
npm install @types/react @types/react-dom
```

---

## Environment Variables

### React (Create React App)

```env
REACT_APP_CHAT_SERVICE_URL=https://api.chat.example.com
REACT_APP_TENANT_ID=your-tenant-id
REACT_APP_APP_ID=your-app-id
```

### Next.js

```env
NEXT_PUBLIC_CHAT_SERVICE_URL=https://api.chat.example.com
NEXT_PUBLIC_TENANT_ID=your-tenant-id
NEXT_PUBLIC_APP_ID=your-app-id
```

### Vite

```env
VITE_CHAT_SERVICE_URL=https://api.chat.example.com
VITE_TENANT_ID=your-tenant-id
VITE_APP_ID=your-app-id
```

---

## Support

For issues and feature requests, please contact your Chat Service administrator or open a support ticket.

---

## License

MIT License - see LICENSE file for details.
