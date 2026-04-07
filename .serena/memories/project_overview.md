# Huddle Chat App Project Overview

## Technology Stack
- **Frontend**: Next.js 16.2.2, React 19.2.4, TypeScript 5
- **Backend**: Supabase (PostgreSQL, Auth, Realtime)
- **State Management**: Zustand 5.0.12
- **UI**: Tailwind CSS 4, shadcn/ui components
- **Virtualization**: @tanstack/react-virtual 3.13.23

## Project Structure
- `/src/app` - Next.js App Router pages
- `/src/app/(workspace)/[workspace]/[channel]` - Channel view
- `/src/lib/supabase` - Supabase client and utilities
- `/src/stores` - Zustand stores
- `/src/components` - Reusable components
- `supabase/migrations` - Database migrations

## Key Files
- `page.tsx` - Server component that fetches channel data
- `channel-view.tsx` - Client component with message list and realtime updates
- `message-item.tsx` - Individual message component with reactions

## Database Schema
- `profiles` - User profiles
- `messages` - Chat messages (unified table for channels, DMs, threads)
- `reactions` - Message reactions (unique on message_id, user_id, emoji)
- `channel_members` - Channel membership
- `channels` - Channel definitions

## Key Features
- Real-time messaging via Supabase Realtime
- Message reactions (emoji)
- Thread replies
- Message editing and soft deletes
- Optimistic updates for UI responsiveness
