// Supabase CLIで生成する型の代わりに、手動型定義を使用
// 本番ではsupabase gen typesで自動生成に切り替え推奨

export type Profile = {
  id: string;
  email: string;
  display_name: string;
  avatar_url: string | null;
  status: string | null;
  last_seen_at: string | null;
};

export type Workspace = {
  id: string;
  name: string;
  slug: string;
  created_at: string;
};

export type Channel = {
  id: string;
  workspace_id: string;
  name: string;
  slug: string;
  is_private: boolean;
  is_dm: boolean;
  topic: string | null;
  created_by: string;
  created_at: string;
};

export type Message = {
  id: string;
  channel_id: string;
  user_id: string;
  parent_id: string | null;
  content: string;
  edited_at: string | null;
  deleted_at: string | null;
  is_decision: boolean;
  reply_count: number;
  created_at: string;
};

export type Reaction = {
  id: string;
  message_id: string;
  user_id: string;
  emoji: string;
  created_at: string;
};

export type ChannelMember = {
  channel_id: string;
  user_id: string;
  joined_at: string;
  last_read_at: string | null;
  muted: boolean;
};

// メッセージ + プロフィール結合型
export type MessageWithProfile = Message & {
  profiles: Profile;
  reactions?: Reaction[];
};
