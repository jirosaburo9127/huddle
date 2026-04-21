import Capacitor
import AVKit

/// ネイティブ動画プレーヤープラグイン
/// HEVC/MOV含む全動画フォーマットをアプリ内で再生（Chatwork方式）
@objc(VideoPlayerPlugin)
public class VideoPlayerPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "VideoPlayerPlugin"
    public let jsName = "VideoPlayer"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "play", returnType: CAPPluginReturnPromise)
    ]

    @objc func play(_ call: CAPPluginCall) {
        guard let urlString = call.getString("url"),
              let url = URL(string: urlString) else {
            call.reject("Invalid URL")
            return
        }

        DispatchQueue.main.async { [weak self] in
            let player = AVPlayer(url: url)
            let playerVC = AVPlayerViewController()
            playerVC.player = player

            self?.bridge?.viewController?.present(playerVC, animated: true) {
                player.play()
            }

            call.resolve()
        }
    }
}
