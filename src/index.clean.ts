// ==========================================
// Chat SDK - Main Entry Point
// Clean, tenant-based chat widget SDK
// ==========================================

// Components
export { ChatWidget } from './ChatWidget.clean';
export type { ChatWidgetProps } from './ChatWidget.clean';

// Provider & Hooks
export { ChatProvider, useChat, useChatState, useChatActions } from './context.clean';

// Client (for advanced usage)
export { ChatWebSocketClient } from './client.clean';

// Types
export type {
  // Config
  ChatSDKConfig,
  ChatTheme,
  ChatFeatures,
  ChatCallbacks,
  
  // Core types
  ChatMode,
  ChatStatus,
  SenderType,
  MessageType,
  
  // Data types
  ChatMessage,
  ChatSession,
  
  // State types
  ChatSDKState,
  ChatSDKActions,
  ChatSDKContextValue,
  
  // API types
  APIResponse,
  WidgetTokenResponse,
  CreateSessionResponse,
  WidgetConfigResponse,
} from './types.clean';

// Event constants
export { WS_EVENTS } from './types.clean';

// ==========================================
// Quick Start Example
// ==========================================
/*
import { ChatWidget } from '@your-org/chat-sdk';

function App() {
  return (
    <ChatWidget
      config={{
        serviceUrl: 'https://chat-api.example.com',
        tenantId: 'your-tenant',
        appId: 'your-app',
        token: userJwtToken,
        user: {
          id: 'user-123',
          name: 'John Doe',
          email: 'john@example.com'
        },
        theme: {
          primaryColor: '#6366f1',
          position: 'bottom-right'
        },
        callbacks: {
          onMessage: (msg) => console.log('Message:', msg),
          onAgentJoined: (id, name) => console.log('Agent:', name),
          onError: (err) => console.error('Error:', err)
        },
        debug: process.env.NODE_ENV === 'development'
      }}
    />
  );
}
*/

// ==========================================
// Advanced Usage - Custom UI
// ==========================================
/*
import { ChatProvider, useChat } from '@your-org/chat-sdk';

function CustomChat() {
  const { state, actions } = useChat();
  
  return (
    <div>
      <div>
        {state.messages.map(msg => (
          <div key={msg.id}>{msg.content}</div>
        ))}
      </div>
      <button onClick={() => actions.sendMessage('Hello!')}>
        Send
      </button>
    </div>
  );
}

function App() {
  return (
    <ChatProvider config={config}>
      <CustomChat />
    </ChatProvider>
  );
}
*/

// ==========================================
// Headless Mode - Direct Client
// ==========================================
/*
import { ChatWebSocketClient } from '@your-org/chat-sdk';

const client = new ChatWebSocketClient({
  serviceUrl: 'https://chat-api.example.com',
  tenantId: 'your-tenant',
  appId: 'your-app',
  token: 'jwt-token',
  user: { id: 'user-123', name: 'John' },
  debug: true
});

// Connect
const session = await client.connect();
console.log('Connected to session:', session.id);

// Listen for messages
client.on('message', (msg) => {
  console.log('Received:', msg.content);
});

// Send message
await client.sendMessage('Hello!');
*/
