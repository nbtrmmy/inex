# インタラクティブアート：ローカルHTTPS開発環境 仕様書

**対象環境**：Mac + iPhone（Safari）+ 自宅Wi-Fi  
**目的**：クラウドへのデプロイなしで、iPhoneの「振る・喋る・描く」をMac上のNode.jsへ送り、MacのThree.jsにリアルタイム反映する。  
**構築方式**：Node.js / Express / Socket.IO / Three.js / mkcert / HTTPS

## 1. 目標と対象外

### 目標
- MacでNode.jsサーバーを起動し、iPhoneのChromeからHTTPSでアクセスできる。
- iPhoneで加速度センサー（DeviceMotionEvent）、マイク（getUserMedia / Web Audio API）、タッチ描画（Pointer Events）を利用できる。
- Socket.IOを使い、スマホの入力をMacの表示画面（Three.js）へ送る。
-　クラウドのデプロイは無し
- ルーターのポート開放を行わず、インターネットからMacの開発サーバーへ直接アクセスできない構成にする。

### 対象外
- クラウド構築
- 50台規模の負荷検証
- 大学Wi-Fiなど第三者管理ネットワークでの動作保証

## 2. ネットワーク構成

```text
                   自宅Wi-Fiルーター
                    /           \
             Mac（開発機）     iPhone（Chrome）
             Node.js :3000       │
             Express             │ HTTPS + Socket.IO
             Socket.IO <─────────┘
                 │
             Macのブラウザ
             Three.js 表示画面
```

- MacとiPhoneを**同じ自宅Wi-Fi**に接続する。
- MacのローカルIPアドレス（例：`192.168.1.10`）を調べる。IPは環境により異なる。
- Macからは `https://localhost:3000/display`、iPhoneからは `https://<MacのIP>:3000/input` にアクセスする。
- Node.jsはLAN接続を受けられるように待ち受ける。Macのファイアウォールで不要な接続を制限する。
- ルーターのポート転送（ポート開放）、DMZ、UPnP経由の公開設定は使わない。

> 注意：HTTPSは通信の暗号化とサーバー証明書の検証を提供するが、ログイン認証そのものではない。LAN内の他端末からのアクセスを完全に防ぐものでもない。

## 3. 使用技術と役割

| 技術 | 役割 |
|---|---|
| Node.js | MacでJavaScriptサーバーを実行 |
| Express | `/input` と `/display` の画面を配信 |
| Socket.IO | 入力と表示のリアルタイム通信 |
| Three.js | Macのブラウザで3D描画 |
| mkcert | 開発用の認証局とHTTPS証明書を生成 |
| Safari | iPhoneのセンサー・マイク・タッチ操作 |

## 4. 準備するもの

- Mac（ターミナルが使えること）
- iPhone（Chromeが使えること）
- 自宅Wi-Fi（端末同士の通信が許可されていること）
- MacにNode.js（推奨：現行LTS）
- MacにHomebrew（ない場合は公式手順で導入）
- mkcert

公式資料：
- mkcert: https://github.com/FiloSottile/mkcert
- Node.js: https://nodejs.org/
- Homebrew: https://brew.sh/
- Socket.IO: https://socket.io/docs/v4/
- Apple（手動インストールした証明書の信頼）: https://support.apple.com/en-us/102390

## 5. 構築手順

### Step 0：先にHTTPで端末間通信を確認する

HTTPS証明書を作る前に、MacとiPhoneがWi-Fi内で通信できるか確認する。

1. MacとiPhoneを同じ自宅Wi-Fiにつなぐ。
2. Macのターミナルで `ipconfig getifaddr en0` を実行する。表示されない場合は「システム設定 → Wi-Fi → 詳細」などでIPv4アドレスを確認する（Wi-Fiのインターフェース名が `en0` とは限らない）。
3. 任意の空の作業フォルダで `python3 -m http.server 8000 --bind 0.0.0.0` を実行する（Python 3がインストール済みの場合）。
4. iPhoneのSafariで `http://<MacのIP>:8000` を開く。
5. ページが表示されたら端末間通信はOK。`Ctrl+C` でテストサーバーを停止する。

表示されない場合は、Macのファイアウォール、接続先Wi-Fi、端末分離設定、IPアドレスを確認する。HTTPテストは通信確認だけに使い、センサーやマイクの検証には使わない。

### Step 1：mkcertをインストール

Homebrew導入済みのMacで：

```bash
brew install mkcert
mkcert -install
```

`mkcert -install` は開発用の認証局（CA）をMacに作成し、Mac側で信頼するための設定を行う。

### Step 2：MacのIPアドレスを確認

```bash
ipconfig getifaddr en0
```

例：`192.168.1.10`。この後のコマンドでは実際のIPに置き換える。

### Step 3：HTTPS証明書を作る

プロジェクト直下で実行：

```bash
mkdir -p certs
mkcert -cert-file certs/dev-cert.pem -key-file certs/dev-key.pem localhost 127.0.0.1 192.168.1.10
```

- `dev-cert.pem`：サーバー証明書
- `dev-key.pem`：サーバー秘密鍵
- **秘密鍵はGitにコミットしない。**
- 証明書には指定したホスト名・IPだけが有効。Wi-Fiを変えてMacのIPが変わった場合は、新しいIPを含むサーバー証明書を再発行する必要がある。**iPhoneに入れたCAが同じなら、CAの再インストールは通常不要。**

`.gitignore` の例：

```gitignore
node_modules/
.env
certs/
*.pem
```

### Step 4：Node.jsプロジェクトを準備

```bash
npm init -y
npm install express socket.io
mkdir -p server client/input client/display
```

次の `server/index.js` は最小の通信確認用。既存プロジェクトがある場合はその構成に合わせて統合する。

```javascript
const express = require('express');
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');
const { Server } = require('socket.io');

const app = express();
const root = path.resolve(__dirname, '..');

app.use('/input', express.static(path.join(root, 'client/input')));
app.use('/display', express.static(path.join(root, 'client/display')));

const server = https.createServer({
  key: fs.readFileSync(path.join(root, 'certs/dev-key.pem')),
  cert: fs.readFileSync(path.join(root, 'certs/dev-cert.pem')),
}, app);

const io = new Server(server);

io.on('connection', (socket) => {
  console.log('connected:', socket.id);
  socket.on('shake', (data) => {
    // 最小デモ：数値であることと範囲を確認してから表示クライアントへ転送
    const strength = data?.strength;
    if (typeof strength !== 'number' || !Number.isFinite(strength) || strength < 0 || strength > 1) return;
    io.emit('shake', { strength });
  });
});

server.listen(3000, '0.0.0.0', () => {
  console.log('Local HTTPS server listening on port 3000');
});
```

> このサンプルは開発用の疎通確認。認証、役割別アクセス制御、レート制限、描画データ検証などは別途実装する。大学などの共有ネットワークへそのまま持ち出さない。

### Step 5：最小の入力・表示ページを作る

`client/input/index.html`：

```html
<!doctype html>
<html lang="ja">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>入力テスト</title>
<button id="start">振る入力を開始</button>
<p id="status">待機中</p>
<script src="/socket.io/socket.io.js"></script>
<script>
  const socket = io();
  const status = document.getElementById('status');
  document.getElementById('start').addEventListener('click', async () => {
    status.textContent = `Secure Context: ${window.isSecureContext}`;
    if (!window.isSecureContext) return;
    try {
      if (typeof DeviceMotionEvent === 'undefined') {
        status.textContent = 'DeviceMotionEvent非対応';
        return;
      }
      if (typeof DeviceMotionEvent.requestPermission === 'function') {
        const permission = await DeviceMotionEvent.requestPermission();
        if (permission !== 'granted') {
          status.textContent = '許可されませんでした';
          return;
        }
      }
      let lastSent = 0;
      window.addEventListener('devicemotion', (event) => {
        const a = event.accelerationIncludingGravity;
        if (!a || ![a.x, a.y, a.z].every(Number.isFinite)) return;
        const now = Date.now();
        if (now - lastSent < 100) return; // 最大約10回/秒
        lastSent = now;
        const magnitude = Math.hypot(a.x, a.y, a.z);
        const strength = Math.min(1, Math.max(0, (Math.abs(magnitude - 9.81) - 1) / 15));
        status.textContent = `強度: ${strength.toFixed(2)}`;
        socket.emit('shake', { strength });
      });
      status.textContent = '開始しました。iPhoneを軽く動かしてください';
    } catch (err) {
      status.textContent = `エラー: ${err.message}`;
    }
  });
</script>
</html>
```

※ 強度の計算は**暫定的なデモ用**。重力や端末姿勢、ノイズの影響を受けるため、実際の「振る」判定は端末で調整する。

`client/display/index.html`：

```html
<!doctype html>
<html lang="ja">
<meta charset="utf-8">
<title>表示テスト</title>
<h1>Three.js接続前の通信テスト</h1>
<p id="result">入力待ち</p>
<script src="/socket.io/socket.io.js"></script>
<script>
  const socket = io();
  socket.on('shake', ({ strength }) => {
    document.getElementById('result').textContent = `振る強度: ${strength.toFixed(2)}`;
    // 完成版ではここでThree.jsのオブジェクトを変化させる
  });
</script>
</html>
```

### Step 6：サーバーを起動

```bash
node server/index.js
```

Macのブラウザで `https://localhost:3000/display` を開く。Mac側で証明書が信頼されているか確認する。

### Step 7：iPhoneへ開発用CA証明書をインストール

MacでCAの保存場所を確認：

```bash
mkcert -CAROOT
```

表示されたフォルダに `rootCA.pem` と `rootCA-key.pem` がある。

1. **`rootCA.pem` だけ**をiPhoneへAirDropなどで転送する。iOSがプロファイルとして認識しない場合は、公開CA証明書を `.cer` 拡張子にコピーして転送する方法を試す。
2. iPhoneの「設定」でダウンロード済みプロファイルを開き、インストールする（iOSのバージョンによって画面の名称は異なる）。
3. 「設定 → 一般 → 情報 → 証明書信頼設定」で、インストールしたルートCAの**完全な信頼**を有効にする。
4. **`rootCA-key.pem` は絶対に送らない。** この秘密鍵が漏れると、そのCAによる証明書の偽装リスクが生じる。

開発用CAを信頼すると、そのCAで署名した証明書をiPhoneが信頼する。自分が管理するCAだけを使い、不要になったら削除する。

### Step 8：iPhoneでHTTPSに接続

Safariで：

```text
https://192.168.1.10:3000/input
```

※ 実際のMacのIPに置き換える。

- 証明書警告が出ないことを確認。
- 「振る入力を開始」をタップし、センサー許可を求められたら許可。
- iPhoneを軽く動かし、Macの `/display` 画面に強度が表示されることを確認。
- センサーが動かない場合は `window.isSecureContext`、Safariのモーションアクセス設定、端末対応、証明書の信頼設定を確認。

### Step 9：マイク・描画を追加

- **マイク**：iPhoneのユーザー操作（ボタン）から `navigator.mediaDevices.getUserMedia({audio:true})` を呼び出し、許可を得てWeb Audio APIで音量を算出する。まずは音量の数値のみをSocket.IOで送信し、録音データの転送は必要になった段階で設計する。
- **描画**：Canvas + Pointer Eventsでタッチ座標を取得し、必要に応じて正規化してSocket.IOで送信する。
- **表示**：MacのThree.jsで `shake` / `voice` / `draw` を受信して作品に反映する。
- **認証**：最終的に入力端末と表示端末を区別し、サーバー側でロール検証する。

## 6. 開発時の運用

1. MacとiPhoneを自宅Wi-Fiに接続。
2. MacのIPを確認。前回と異なる場合はサーバー証明書のIPを確認し、必要なら再発行。
3. Macで `node server/index.js` を起動。
4. Macで `https://localhost:3000/display` を開く。
5. iPhoneで `https://<MacのIP>:3000/input` を開く。
6. コードを編集して、必要ならNode.jsを再起動。ブラウザを再読み込みしてテスト。

開発を効率化するなら `node --watch server/index.js` を使う（Node.jsの対応バージョンで利用可能）。クライアント側の自動更新には別途Viteなどを検討する。

## 7. セキュリティ要件

- 自宅Wi-Fiに強いパスワード（WPA2/WPA3）を設定する。
- ルーターのポート開放・DMZを使わない。
- Macのファイアウォールを有効にし、必要な通信だけ許可する。
- 開発サーバーは必要なときだけ起動する。
- サーバー証明書の秘密鍵、CA秘密鍵、`.env` をGitHubへ公開しない。
- 不特定多数のネットワークでの運用時は、サーバー側の認証・入力検証・レート制限を必須とする。
- HTTPSだけでSocket.IOの接続認証が済んだと誤解しない。

## 8. よくある問題と切り分け

| 症状 | 確認すること |
|---|---|
| iPhoneからページが開けない | 同じWi-Fiか、MacのIPが正しいか、ファイアウォール、端末間通信の遮断 |
| 証明書の警告が出る | iPhoneのCAインストールと完全信頼、証明書のIP一致、期限 |
| `isSecureContext` が `false` | HTTPS証明書が信頼されているか、HTTPで開いていないか |
| 加速度が取得できない | タップ操作から許可を要求したか、Safari設定、対応端末か |
| Socket.IOがつながらない | Node.js起動状態、ブラウザの開発者ツール、HTTPS/WSS接続先 |
| Wi-Fiを変えたら使えない | MacのIP変更、ネットワークの端末間通信制限、証明書の再発行 |

## 9. 完了条件（チェックリスト）

- [ ] MacとiPhoneが同じWi-Fiで通信できる
- [ ] MacでHTTPSサーバーが起動する
- [ ] iPhoneのSafariで証明書警告なく `/input` が開ける
- [ ] `window.isSecureContext === true` が確認できる
- [ ] iPhoneの加速度センサーを許可できる
- [ ] iPhoneを動かすとMacの `/display` に値が届く
- [ ] マイク入力の許可と音量取得ができる
- [ ] Canvasのタッチ入力を送信できる
- [ ] 秘密鍵がGitに含まれていない
- [ ] ルーターのポート開放をしていない

## 10. 本番環境への移行方針

- クラウド上のNode.js + Express + Socket.IOへデプロイする。
- HTTPSはクラウドサービスの正規証明書を使用し、開発用CAや秘密鍵はデプロイしない。
- ブラウザ側は同じオリジンに接続する `io()` を基本とし、接続先のハードコードを避ける。
- ログイン認証、Socket.IO接続認証、表示ロールの検証、入力検証、レート制限を実装する。
- スマホ実機での操作感と複数端末の負荷を本番相当環境で検証する。

---

**補足**：この仕様書のサンプルコードは、最初のHTTPS・Socket.IO・加速度センサー疎通確認に絞ったもの。作品の本体実装や本番セキュリティ対策は次の開発段階で追加する。
