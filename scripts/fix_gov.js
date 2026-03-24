"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
var supabase_js_1 = require("@supabase/supabase-js");
require("dotenv/config");
var supabase = (0, supabase_js_1.createClient)(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
var GABINETE_ID = process.env.GABINETE_ID || 'f25299db-1c33-45b9-830f-82f6d2d666ef';
function fixGov() {
    return __awaiter(this, void 0, void 0, function () {
        var orgId, orgs, newOrg, personId, persons, photoUrl, newPerson, apps, oldDate, oldDate, _a, newApp, errApp;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    console.log('Verificando se Governo do Estado de Roraima existe...');
                    orgId = '';
                    return [4 /*yield*/, supabase
                            .from('cadin_organizations')
                            .select('id')
                            .ilike('name', '%Governo do Estado de Roraima%')];
                case 1:
                    orgs = (_b.sent()).data;
                    if (!(orgs && orgs.length > 0)) return [3 /*break*/, 3];
                    orgId = orgs[0].id;
                    console.log('Org encontrada:', orgId);
                    // Atualizar endereço no banco caso já exista sem endereço
                    return [4 /*yield*/, supabase.from('cadin_organizations')
                            .update({
                            endereco: 'Palácio Senador Hélio Campos - Praça do Centro Cívico, s/n - Boa Vista – RR - CEP: 69.301-380',
                            phone: '(95) 2121-7930',
                            email: 'antonio.denarium@casacivil.rr.gov.br'
                        })
                            .eq('id', orgId)];
                case 2:
                    // Atualizar endereço no banco caso já exista sem endereço
                    _b.sent();
                    return [3 /*break*/, 5];
                case 3: return [4 /*yield*/, supabase
                        .from('cadin_organizations')
                        .insert({
                        gabinete_id: GABINETE_ID,
                        name: 'Governo do Estado de Roraima',
                        acronym: 'GOV-RR',
                        sphere: 'estadual',
                        endereco: 'Palácio Senador Hélio Campos - Praça do Centro Cívico, s/n - Boa Vista – RR - CEP: 69.301-380',
                        phone: '(95) 2121-7930',
                        email: 'antonio.denarium@casacivil.rr.gov.br'
                    })
                        .select('id')
                        .single()];
                case 4:
                    newOrg = (_b.sent()).data;
                    orgId = (newOrg === null || newOrg === void 0 ? void 0 : newOrg.id) || '';
                    console.log('Org criada:', orgId);
                    _b.label = 5;
                case 5:
                    personId = '';
                    return [4 /*yield*/, supabase
                            .from('cadin_persons')
                            .select('id')
                            .ilike('full_name', 'Antonio Oliverio Garcia de Almeida')];
                case 6:
                    persons = (_b.sent()).data;
                    if (!(persons && persons.length > 0)) return [3 /*break*/, 7];
                    personId = persons[0].id;
                    console.log('Pessoa encontrada:', personId);
                    return [3 /*break*/, 9];
                case 7:
                    photoUrl = 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/cd/Antonio_Denarium_em_2023_%28cropped%29.jpg/200px-Antonio_Denarium_em_2023_%28cropped%29.jpg';
                    return [4 /*yield*/, supabase
                            .from('cadin_persons')
                            .insert({
                            gabinete_id: GABINETE_ID,
                            full_name: 'Antonio Oliverio Garcia de Almeida',
                            party: 'PROGRESSISTAS',
                            email: 'adriana.brandao@casacivil.rr.gov.br', // Email do Chefe de Gab
                            notes: 'Aniversário: 03 DE MARÇO. CHEFE DE GABINETE: Adriana Brandão / Lidiane - (95) 98123-6341 / 99113-2343',
                            photo_url: photoUrl
                        })
                            .select('id')
                            .single()];
                case 8:
                    newPerson = (_b.sent()).data;
                    personId = (newPerson === null || newPerson === void 0 ? void 0 : newPerson.id) || '';
                    console.log('Pessoa criada:', personId);
                    _b.label = 9;
                case 9:
                    if (!orgId || !personId) {
                        console.error('Falha ao criar registros.');
                        return [2 /*return*/];
                    }
                    return [4 /*yield*/, supabase
                            .from('cadin_appointments')
                            .select('id')
                            .eq('person_id', personId)
                            .eq('organization_id', orgId)];
                case 10:
                    apps = (_b.sent()).data;
                    if (!(apps && apps.length > 0)) return [3 /*break*/, 12];
                    console.log('Cargo já existe:', apps[0].id);
                    oldDate = new Date('2000-01-01T00:00:00Z').toISOString();
                    return [4 /*yield*/, supabase.from('cadin_appointments')
                            .update({ active: true, created_at: oldDate, title: 'Governador do Estado' })
                            .eq('id', apps[0].id)];
                case 11:
                    _b.sent();
                    return [3 /*break*/, 14];
                case 12:
                    oldDate = new Date('2000-01-01T00:00:00Z').toISOString();
                    return [4 /*yield*/, supabase
                            .from('cadin_appointments')
                            .insert({
                            gabinete_id: GABINETE_ID,
                            person_id: personId,
                            organization_id: orgId,
                            title: 'Governador',
                            active: true,
                            created_at: oldDate
                        })
                            .select('id')
                            .single()];
                case 13:
                    _a = _b.sent(), newApp = _a.data, errApp = _a.error;
                    if (errApp)
                        console.error('Error insert app:', errApp);
                    console.log('Cargo inserido:', newApp === null || newApp === void 0 ? void 0 : newApp.id);
                    _b.label = 14;
                case 14:
                    console.log('Sucesso! O governador foi adicionado no topo do Caderno.');
                    return [2 /*return*/];
            }
        });
    });
}
fixGov();
