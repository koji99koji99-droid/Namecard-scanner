export const metadata = {
  title: "名刺スキャナー",
  description: "名刺をカメラで読み取りCSVデータベース化",
};

export default function RootLayout({ children }) {
  return (
    <html lang="ja">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
      </head>
      <body style={{ margin: 0 }}>{children}</body>
    </html>
  );
}
