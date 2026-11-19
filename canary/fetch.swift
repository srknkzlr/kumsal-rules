// Kanarya getiricisi: sayfayı uygulamanın kullandığı Apple ağ yığınıyla (URLSession) çeker.
// Neden: akorlar.com / akorlab.com Cloudflare'i Node/curl TLS parmak izini engelliyor, URLSession'ı
// geçiriyor — kanarya uygulamanın gördüğünü görsün. Kullanım: fetch <url> → stdout HTML,
// stderr ilk satır "status <kod>". Yalnız okur; hiçbir dosyaya yazmaz.
import Foundation

let url = URL(string: CommandLine.arguments[1])!
var request = URLRequest(url: url, timeoutInterval: 20)
request.setValue("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
                 forHTTPHeaderField: "User-Agent")
request.setValue("tr-TR,tr;q=0.9,en;q=0.8", forHTTPHeaderField: "Accept-Language")
let done = DispatchSemaphore(value: 0)
URLSession.shared.dataTask(with: request) { data, response, error in
    if let http = response as? HTTPURLResponse {
        FileHandle.standardError.write("status \(http.statusCode)\n".data(using: .utf8)!)
    } else {
        FileHandle.standardError.write("status 0 \(error?.localizedDescription ?? "")\n".data(using: .utf8)!)
    }
    if let data { FileHandle.standardOutput.write(data) }
    done.signal()
}.resume()
done.wait()
