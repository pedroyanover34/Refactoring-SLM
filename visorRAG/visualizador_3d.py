import chromadb
import umap
import pandas as pd
import plotly.express as px
import argparse
import json
from dash import Dash, dcc, html, Input, Output

def visualizar_chroma(db_path, collection_name):
    print(f"📂 Conectando a la base de datos en: {db_path}")
    client = chromadb.PersistentClient(path=db_path)
    
    try:
        collection = client.get_collection(name=collection_name)
    except Exception as e:
        print(f"❌ Error: No se encontró la colección '{collection_name}'.")
        return

    print("⏳ Extrayendo vectores y documentos...")
    data = collection.get(include=["embeddings", "documents", "metadatas"])
    
    embeddings = data.get("embeddings")
    documents = data.get("documents")
    metadatas = data.get("metadatas")

    # Corrección para el arreglo NumPy vacío
    if embeddings is None or len(embeddings) == 0:
        print("⚠️ La colección está vacía o no tiene embeddings guardados.")
        return

    print(f"✅ Se encontraron {len(embeddings)} vectores.")
    print("🧠 Reduciendo dimensiones con UMAP...")
    
    reducer = umap.UMAP(n_components=3, random_state=42, metric='cosine')
    embeddings_3d = reducer.fit_transform(embeddings)

    # Truncamos el texto solo para el hover, guardamos el original entero
    textos_cortos = [doc[:80] + "..." if doc else "Sin texto" for doc in documents]
    categorias = [meta.get("fuente", "General") if meta else "General" for meta in metadatas]

    # Armamos el DataFrame con toda la info y un ID
    df = pd.DataFrame(embeddings_3d, columns=["x", "y", "z"])
    df["ID"] = range(len(df))
    df["Texto_Hover"] = textos_cortos
    df["Texto_Completo"] = documents
    df["Categoria"] = categorias
    df["Metadata_Original"] = metadatas

    print("📊 Preparando el panel interactivo...")
    
    # Gráfico 3D inyectando el ID en la custom_data
    fig = px.scatter_3d(
        df, x='x', y='y', z='z',
        color='Categoria',
        hover_name='Texto_Hover',
        custom_data=['ID'],
        opacity=0.7,
        size_max=5
    )
    fig.update_layout(
        template="plotly_dark", 
        margin=dict(l=0, r=0, b=0, t=0),
        scene=dict(bgcolor='#1e1e1e')
    )

    # --- APLICACIÓN DASH ---
    app = Dash(__name__)

    # Layout de vista dividida
    app.layout = html.Div(style={'display': 'flex', 'height': '100vh', 'backgroundColor': '#1e1e1e', 'color': '#d4d4d4', 'fontFamily': 'sans-serif'}, children=[
        
        html.Div(dcc.Graph(id='grafico-3d', figure=fig, style={'height': '100vh'}), style={'width': '70%'}),
        
        html.Div(style={'width': '30%', 'padding': '25px', 'borderLeft': '1px solid #333', 'overflowY': 'auto', 'backgroundColor': '#252526'}, children=[
            html.H2("Detalles del Nodo", style={'marginTop': '0', 'color': '#ffffff'}),
            html.P("Hacé clic en un punto del espacio 3D para inspeccionar el fragmento y su metadata.", style={'color': '#9cdcfe'}),
            
            # Contenedor dinámico del panel derecho
            html.Div(id='panel-info')
        ])
    ])

    @app.callback(
        Output('panel-info', 'children'),
        Input('grafico-3d', 'clickData')
    )
    def actualizar_panel(clickData):
        if clickData is None:
            return html.Div()

        try:
            punto = clickData['points'][0]
            
            # Intentamos sacar el ID desde customdata
            punto_id = punto.get('customdata', [None])[0]
            
            # Fallback seguro si Plotly no envió la customdata
            if punto_id is None:
                punto_id = punto.get('pointNumber')

            if punto_id is None:
                raise ValueError("Plotly no devolvió ni el customdata ni el pointNumber.")

            punto_id = int(punto_id)
            fila = df[df['ID'] == punto_id].iloc[0]
            
            texto_completo = fila['Texto_Completo']
            meta = fila['Metadata_Original']
            meta_json = json.dumps(meta, indent=2, ensure_ascii=False) if meta else "{}"

            return html.Div([
                html.H3("Metadata", style={'color': '#4ec9b0', 'borderBottom': '1px solid #444', 'paddingBottom': '5px'}),
                html.Pre(meta_json, style={'backgroundColor': '#1e1e1e', 'padding': '15px', 'borderRadius': '5px', 'overflowX': 'auto', 'fontSize': '13px'}),
                
                html.H3("Contenido / Código", style={'color': '#569cd6', 'borderBottom': '1px solid #444', 'paddingBottom': '5px', 'marginTop': '25px'}),
                html.Pre(texto_completo, style={'backgroundColor': '#1e1e1e', 'padding': '15px', 'borderRadius': '5px', 'overflowX': 'auto', 'whiteSpace': 'pre-wrap', 'fontSize': '13px', 'fontFamily': 'monospace'})
            ])
            
        except Exception as e:
            # Captura de errores visible en la UI
            return html.Div([
                html.H3("⚠️ Error procesando el clic", style={'color': '#f44336'}),
                html.P(f"Detalle: {str(e)}"),
                html.Pre(f"Datos crudos del clic:\n{json.dumps(clickData, indent=2)}", style={'color': 'white', 'fontSize': '11px', 'backgroundColor': '#1e1e1e', 'padding': '10px'})
            ])

    print("🚀 Servidor listo. Abrí tu navegador en http://127.0.0.1:8050")
    
    # Corrección para versiones nuevas de Dash y debug activado
    app.run(debug=True, use_reloader=False)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Visualizador 3D de ChromaDB con Panel de Detalles")
    parser.add_argument("--path", type=str, required=True, help="Ruta a la carpeta de ChromaDB")
    parser.add_argument("--collection", type=str, required=True, help="Nombre de la colección a visualizar")
    
    args = parser.parse_args()
    visualizar_chroma(args.path, args.collection)