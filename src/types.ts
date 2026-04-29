// Microsoft Graph-shaped types used by both fixtures and the real Outlook
// integration. Keeping these aligned with what Graph returns means our
// renderer can consume either source without translation.

export interface EmailAddress {
  name: string;
  address: string;
}

export interface MessageBody {
  contentType: "html" | "text";
  content: string;
}

export interface AttachmentRef {
  id: string;
  name: string;
  contentType: string;
  size: number;
  isInline: boolean;
  contentId?: string;
  // For inline images, we'll resolve this to a data URL or a Graph-served URL.
  contentBytes?: string;
}

export interface MentionRef {
  id: number;
  mentioned: EmailAddress;
  createdBy: EmailAddress;
}

export interface Message {
  id: string;
  conversationId: string;
  subject: string;
  sender: EmailAddress;
  toRecipients: EmailAddress[];
  ccRecipients: EmailAddress[];
  sentDateTime: string;
  receivedDateTime: string;
  hasAttachments: boolean;
  attachments?: AttachmentRef[];
  body: MessageBody;
  mentions?: MentionRef[];
}

export interface Conversation {
  name?: string;
  description?: string;
  conversationId: string;
  currentUser: EmailAddress;
  messages: Message[];
}
