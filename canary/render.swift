// Kanarya çizici: sayfayı uygulamanın gizli yükleyicisi gibi WebKit'te (WKWebView, mobil içerik
// modu) çalıştırır ve çizilmiş DOM'u verir. Neden: akorlab.com tür listesi (Hızlı Başlangıç)
// sunucu HTML'inde yok, istemcide çiziliyor — düz istek (fetch) onu göremez.
// Kullanım: render <url> <hazır-seçici> [saniye=12] → stdout HTML, stderr "status 200|0".
// Seçici görünene (ya da süre dolana) dek bekler. Yalnız okur; hiçbir dosyaya yazmaz.
import AppKit
import WebKit

let url = URL(string: CommandLine.arguments[1])!
let selector = CommandLine.arguments.count > 2 ? CommandLine.arguments[2] : "body"
let limit = CommandLine.arguments.count > 3 ? (Double(CommandLine.arguments[3]) ?? 12) : 12

let app = NSApplication.shared
app.setActivationPolicy(.prohibited)
let configuration = WKWebViewConfiguration()
configuration.defaultWebpagePreferences.preferredContentMode = .mobile
configuration.websiteDataStore = .nonPersistent()
let webView = WKWebView(frame: NSRect(x: 0, y: 0, width: 414, height: 896), configuration: configuration)
webView.customUserAgent = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"
webView.load(URLRequest(url: url))

let started = Date()
let literal = String(data: try! JSONEncoder().encode(selector), encoding: .utf8)!

func finish(found: Bool) {
    webView.evaluateJavaScript("document.documentElement.outerHTML") { result, _ in
        let html = result as? String ?? ""
        FileHandle.standardError.write("status \(html.isEmpty ? 0 : 200) ready=\(found)\n".data(using: .utf8)!)
        FileHandle.standardOutput.write(html.data(using: .utf8)!)
        exit(0)
    }
}

func poll() {
    webView.evaluateJavaScript("document.querySelector(\(literal)) !== null") { result, _ in
        if result as? Bool == true { return finish(found: true) }
        if Date().timeIntervalSince(started) > limit { return finish(found: false) }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3, execute: poll)
    }
}

DispatchQueue.main.asyncAfter(deadline: .now() + 0.5, execute: poll)
app.run()
