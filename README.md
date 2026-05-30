# 楽曲分析ノート

楽曲分析をブラウザに蓄積するための小さなWebアプリです。

- 曲名、アーティスト、BPM、キー、URL、構成メモ、備考を保存できます。
- 表ビューで蓄積した分析を一覧できます。
- 早見表でカポ対応表とメジャーキー3和音を確認できます。
- データは各自のブラウザに保存されるため、共有URLを使っても他の人のデータとは混ざりません。
- Supabaseを設定すると、メールログインで本人のデータを端末間同期できます。

GitHub Pagesで公開する場合は、このフォルダの中身をリポジトリのルートに置いて公開してください。

## ログイン同期を使う場合

1. Supabaseで新しいプロジェクトを作ります。
2. SQL Editorで `supabase-setup.sql` の内容を実行します。
3. Project Settings > API から Project URL と anon/public key をコピーします。
4. Authentication > URL Configuration で Site URL にGitHub PagesのURLを入れます。
5. `supabase-config.js` に貼り付けます。

```js
window.MUSIC_ANALYSIS_SUPABASE = {
  url: "https://xxxx.supabase.co",
  anonKey: "your-anon-key",
};
```

6. GitHubへpushし直します。

ログイン後は、保存時にクラウドへ自動同期されます。手動で「クラウドへ保存」「クラウドから読込」もできます。
