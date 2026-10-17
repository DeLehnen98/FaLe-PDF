import javax.xml.XMLConstants;
import javax.xml.transform.stream.StreamSource;
import javax.xml.validation.*;
import java.io.File;
public class XsdValidate {
  public static void main(String[] a) throws Exception {
    Schema s = SchemaFactory.newInstance(XMLConstants.W3C_XML_SCHEMA_NS_URI).newSchema(new File(a[0]));
    Validator v = s.newValidator();
    try { v.validate(new StreamSource(new File(a[1]))); System.out.println("XSD OK"); }
    catch (org.xml.sax.SAXParseException e) { System.out.println("XSD ERROR line " + e.getLineNumber() + ": " + e.getMessage()); System.exit(1); }
  }
}
