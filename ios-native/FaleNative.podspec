# Native iOS part of FaLe PDF (Capacitor): incoming files (open in place + write back), printing.
# Added to ios/App/Podfile by scripts/cap-patch-ios.mjs; the plugins are listed in App/capacitor.config.json (packageClassList).
Pod::Spec.new do |s|
  s.name = 'FaleNative'
  s.version = '1.0.0'
  s.summary = 'FaLe PDF native helpers (incoming files, write back to the original, printing)'
  s.license = { :type => 'Proprietary', :text => 'FaLe PDF' }
  s.homepage = 'https://fale.network'
  s.author = 'FaLe.dev'
  s.source = { :git => 'https://github.com/DeLehnen98/FaLe-PDF.git', :tag => s.version.to_s }
  s.source_files = 'Sources/**/*.swift'
  s.ios.deployment_target = '15.0'
  s.dependency 'Capacitor'
  s.swift_version = '5.9'
end
