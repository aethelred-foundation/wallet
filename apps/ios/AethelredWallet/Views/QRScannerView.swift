import AVFoundation
import SwiftUI

/// Camera-backed QR scanner. Detects `wc://`, `ethereum:`, `0x…`, and
/// `aethelred://` URIs and calls back with the structured route.
@MainActor
struct QRScannerView: View {

    @Environment(\.themePalette) private var palette
    @Environment(\.dismiss) private var dismiss
    let onDetected: (String) -> Void

    var body: some View {
        ZStack {
            CameraPreview(onDetected: handleDetection)
            overlay
        }
        .ignoresSafeArea()
        .navigationBarHidden(true)
    }

    private var overlay: some View {
        VStack {
            HStack {
                Button {
                    dismiss()
                } label: {
                    Image(systemName: Icons.close)
                        .font(.system(size: 18, weight: .semibold))
                        .foregroundStyle(Color.white)
                        .padding(Spacing.sm)
                        .background(Color.black.opacity(0.4), in: Circle())
                }
                .accessibilityLabel("Close scanner")
                Spacer()
            }
            .padding(Spacing.md)
            Spacer()
            RoundedRectangle(cornerRadius: Radii.lg)
                .stroke(palette.accent, lineWidth: 2)
                .frame(width: 260, height: 260)
            Spacer()
            Text("Point at a WalletConnect QR")
                .font(Typography.label)
                .foregroundStyle(Color.white)
                .padding(.horizontal, Spacing.md)
                .padding(.vertical, Spacing.xs)
                .background(.ultraThinMaterial, in: Capsule())
                .padding(Spacing.xl)
        }
    }

    private func handleDetection(_ string: String) {
        onDetected(string)
        dismiss()
    }
}

/// Thin UIKit bridge around AVCaptureSession.
struct CameraPreview: UIViewRepresentable {
    let onDetected: (String) -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(onDetected: onDetected)
    }

    func makeUIView(context: Context) -> UIView {
        let view = UIView()
        context.coordinator.configure(in: view)
        return view
    }

    func updateUIView(_ uiView: UIView, context: Context) { }

    final class Coordinator: NSObject, AVCaptureMetadataOutputObjectsDelegate {
        let onDetected: (String) -> Void
        private let session = AVCaptureSession()
        private var hasDelivered = false

        init(onDetected: @escaping (String) -> Void) {
            self.onDetected = onDetected
        }

        func configure(in view: UIView) {
            guard let device = AVCaptureDevice.default(for: .video),
                  let input = try? AVCaptureDeviceInput(device: device) else { return }
            session.addInput(input)
            let output = AVCaptureMetadataOutput()
            if session.canAddOutput(output) {
                session.addOutput(output)
                output.setMetadataObjectsDelegate(self, queue: .main)
                output.metadataObjectTypes = [.qr]
            }
            let preview = AVCaptureVideoPreviewLayer(session: session)
            preview.videoGravity = .resizeAspectFill
            preview.frame = view.bounds
            view.layer.addSublayer(preview)
            DispatchQueue.global(qos: .userInitiated).async { [weak self] in
                self?.session.startRunning()
            }
        }

        func metadataOutput(
            _ output: AVCaptureMetadataOutput,
            didOutput metadataObjects: [AVMetadataObject],
            from connection: AVCaptureConnection
        ) {
            guard !hasDelivered else { return }
            guard let code = metadataObjects.compactMap({ ($0 as? AVMetadataMachineReadableCodeObject)?.stringValue }).first else {
                return
            }
            hasDelivered = true
            session.stopRunning()
            onDetected(code)
        }
    }
}
