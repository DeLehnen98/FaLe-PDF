#!/usr/bin/env bash
# Downloads the e-invoice validators into tests/tools/einvoice/vendor/ (not committed):
#   - EN 16931 schematron (CEN, compiled XSLT) + CII/UBL schemas   github.com/ConnectingEurope/eInvoicing-EN16931
#   - XRechnung schematron (KoSIT), compiled here with the ISO skeleton   github.com/itplr-kosit/xrechnung-schematron
#   - Saxon-HE 10.9 (XSLT 2)                                        github.com/Saxonica/Saxon-HE
#   - Mustang CLI 2.20.0 (ZUGFeRD + PDF/A-3 via veraPDF)            github.com/ZUGFeRD/mustangproject
# Needs git, java (17+), unzip and network access to github.com.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p vendor && cd vendor
[ -d en16931 ] || git clone -q --depth 1 https://github.com/ConnectingEurope/eInvoicing-EN16931.git en16931
[ -d xrs ] || git clone -q --depth 1 https://github.com/itplr-kosit/xrechnung-schematron.git xrs
[ -d isosch ] || git clone -q --depth 1 https://github.com/Schematron/schematron.git isosch
if [ ! -f saxonjar/saxon-he-10.9.jar ]; then
  rm -rf saxon && git clone -q --depth 1 --filter=blob:none --sparse https://github.com/Saxonica/Saxon-HE.git saxon
  (cd saxon && git sparse-checkout set --no-cone /10/Java/SaxonHE10-9J.zip)
  mkdir -p saxonjar && (cd saxonjar && unzip -o -q ../saxon/10/Java/SaxonHE10-9J.zip)
fi
[ -f mustang-cli.jar ] || curl -sSL -o mustang-cli.jar https://github.com/ZUGFeRD/mustangproject/releases/download/core-2.20.0/Mustang-CLI-2.20.0.jar
S="java -cp saxonjar/saxon-he-10.9.jar net.sf.saxon.Transform"
C=isosch/trunk/schematron/code
for syn in cii ubl; do
  U=$(echo $syn | tr a-z A-Z)
  [ -f xr-$syn.xsl ] && continue
  $S -s:xrs/src/validation/schematron/$syn/XRechnung-$U-validation.sch -xsl:$C/iso_dsdl_include.xsl -o:xr-$syn-1.sch
  $S -s:xr-$syn-1.sch -xsl:$C/iso_abstract_expand.xsl -o:xr-$syn-2.sch
  $S -s:xr-$syn-2.sch -xsl:$C/iso_svrl_for_xslt2.xsl -o:xr-$syn.xsl
done
echo "e-invoice validators ready in $(pwd)"
