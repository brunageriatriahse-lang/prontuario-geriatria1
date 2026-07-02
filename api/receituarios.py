"""
API serverless Vercel — gera o arquivo Excel de receituários
preenchido com os dados do paciente, preservando formatação original.

Endpoint: POST /api/receituarios
Body JSON: { nome, prontuario, maeNome, idade, sexo, data }
Retorna: arquivo .xlsm para download
"""

import json
import io
import os
import base64
from http.server import BaseHTTPRequestHandler
from openpyxl import load_workbook

MODELO_PATH = os.path.join(os.path.dirname(__file__), "modelo.xlsm")


def preencher_excel(nome, prontuario, mae_nome, idade, sexo, data_doc):
    wb = load_workbook(MODELO_PATH, keep_vba=True)
    ws = wb["Cadastro"]

    def sv(coord, value):
        ws[coord].value = value

    sv("C7", (nome or "").upper())
    sv("C8", prontuario or "")
    sv("C9", (mae_nome or "").upper())
    sv("C12", int(idade) if str(idade).isdigit() else (idade or ""))
    sv("C13", sexo or "")
    sv("C14", "GERIATRIA")
    sv("C16", data_doc or "")

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return buf.read()


class handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(200)
        self._cors()
        self.end_headers()

    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length)) if length else {}

            nome = body.get("nome", "")
            prontuario = str(body.get("prontuario", ""))
            mae_nome = body.get("maeNome", "")
            idade = body.get("idade", "")
            sexo = body.get("sexo", "")
            data_doc = body.get("data", "")

            arquivo = preencher_excel(nome, prontuario, mae_nome, idade, sexo, data_doc)

            nome_arquivo = f"Receituarios_{(nome or 'paciente').replace(' ', '_')}.xlsm"

            self.send_response(200)
            self._cors()
            self.send_header("Content-Type", "application/vnd.ms-excel.sheet.macroEnabled.12")
            self.send_header("Content-Disposition", f'attachment; filename="{nome_arquivo}"')
            self.send_header("Content-Length", str(len(arquivo)))
            self.end_headers()
            self.wfile.write(arquivo)

        except Exception as e:
            self.send_response(500)
            self._cors()
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"error": str(e)}).encode())

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def log_message(self, format, *args):
        pass
