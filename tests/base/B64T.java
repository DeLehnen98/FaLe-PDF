import dev.fale.one.FaleCrypto;
import java.util.*;
public class B64T { public static void main(String[] a){ Random r=new Random(1); for(int n=0;n<300;n++){ byte[] b=new byte[n]; r.nextBytes(b); String e=FaleCrypto.b64u(b); String j=Base64.getUrlEncoder().withoutPadding().encodeToString(b); if(!e.equals(j)) throw new RuntimeException("enc "+n); if(!Arrays.equals(FaleCrypto.unb64u(e),b)) throw new RuntimeException("dec "+n); if(!Arrays.equals(FaleCrypto.unb64u(Base64.getEncoder().encodeToString(b)),b)) throw new RuntimeException("std "+n);} System.out.println("b64 ok"); } }
