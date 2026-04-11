import { WorkspaceLobby } from "./workspace-lobby";

// ワークスペースのトップページ。
// サイドバーにチャンネル/DM一覧はすでに出ているので、メイン領域には
// ウェルカムメッセージと「チャンネルを選択してください」の案内を出す。
// モバイルではサイドバーを自動で開いて、一覧画面として機能させる。
export default async function WorkspacePage({
  params,
}: {
  params: Promise<{ workspace: string }>;
}) {
  const { workspace: workspaceSlug } = await params;
  return <WorkspaceLobby workspaceSlug={workspaceSlug} />;
}
