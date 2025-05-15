
# Documentação da API KDRAMA

## Base URL
`http://0.0.0.0:5000/api`

## Endpoints e Como Usar no Android

### Configuração do Projeto Android

Adicione as dependências no build.gradle:

```gradle
dependencies {
    implementation 'com.squareup.retrofit2:retrofit:2.9.0'
    implementation 'com.squareup.retrofit2:converter-gson:2.9.0'
}
```

### Interface da API

```java
public interface KDramaApi {
    @POST("usuarios/registro")
    Call<AuthResponse> registrarUsuario(@Body RegistroRequest request);
    
    @POST("usuarios/login")
    Call<AuthResponse> login(@Body LoginRequest request);
    
    @GET("doramas")
    Call<DoramasResponse> listarDoramas(
        @Query("page") int page,
        @Query("limit") int limit
    );
    
    @GET("doramas/busca")
    Call<List<Dorama>> buscarDoramas(@Query("q") String query);
    
    @GET("doramas/{id}")
    Call<Dorama> getDoramaDetalhes(@Path("id") String id);
}
```

### Classes de Modelo

```java
public class Dorama {
    private String id;
    private String title;
    private String image;
    private String year;
    private double rating;
}

public class AuthResponse {
    private String token;
}

public class RegistroRequest {
    private String email;
    private String senha;
    private String nome;
}
```

### Exemplo de Uso

```java
public class MainActivity extends AppCompatActivity {
    private KDramaApi api;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        Retrofit retrofit = new Retrofit.Builder()
            .baseUrl("http://0.0.0.0:5000/api/")
            .addConverterFactory(GsonConverterFactory.create())
            .build();

        api = retrofit.create(KDramaApi.class);

        // Exemplo de login
        LoginRequest loginRequest = new LoginRequest("email@example.com", "senha123");
        api.login(loginRequest).enqueue(new Callback<AuthResponse>() {
            @Override
            public void onResponse(Call<AuthResponse> call, Response<AuthResponse> response) {
                if (response.isSuccessful()) {
                    String token = response.body().getToken();
                    // Salvar token e proceder
                }
            }

            @Override
            public void onFailure(Call<AuthResponse> call, Throwable t) {
                // Tratar erro
            }
        });
    }
}
```

## Funcionalidades Disponíveis

1. **Sistema de Autenticação**
   - Registro
   - Login
   - Perfil do usuário

2. **Catálogo de Doramas**
   - Listagem paginada
   - Busca por título
   - Detalhes do dorama
   - Episódios

3. **Sistema VIP**
   - Ativação de conta VIP
   - Benefícios premium
   - Verificação de status

4. **Recursos Extras**
   - Histórico de visualização
   - Sistema de tags
   - Recomendações personalizadas
   - Estatísticas de visualização

## Exemplo de Layout Android (activity_main.xml)

```xml
<?xml version="1.0" encoding="utf-8"?>
<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:orientation="vertical"
    android:padding="16dp">

    <androidx.recyclerview.widget.RecyclerView
        android:id="@+id/recyclerDoramas"
        android:layout_width="match_parent"
        android:layout_height="match_parent" />

</LinearLayout>
```

## Dicas de Implementação

1. Use ViewModel e LiveData para gerenciar estados
2. Implemente cache local com Room Database
3. Utilize Coroutines para operações assíncronas
4. Adicione pull-to-refresh para atualizar dados
5. Implemente paginação com RecyclerView

