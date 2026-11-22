// Initial values and conversions of the S2 forms. Pure functions, tested in tests/s2-api.test.ts.
// International neutrality (contract 1.2.0, D-1, O-3): no country and no calling code is assumed; the only default is the
// project currency, pre-filled from the current company's base currency (read from GET /company, never a constant).
import type { ClientCreate, Company, PartyContactInput, ProjectCreate } from '../api/types';
import { COUNTRIES } from '../api/sample-s2';

export interface ClientForm {
    party_code: string;
    name_ar: string;
    name_en: string;
    country_code: string;
    tax_registration_no: string;
    contact_name: string;
    phone_country: string;
    phone_local: string;
    email: string;
}
export const initialClientForm = (): ClientForm => ({
    party_code: '',
    name_ar: '',
    name_en: '',
    country_code: '', // chosen by the user from the list; never pre-selected
    tax_registration_no: '',
    contact_name: '',
    phone_country: '', // follows the client's country once chosen; never a fixed calling code
    phone_local: '',
    email: ''
});

export const callingCode = (country: string) => COUNTRIES.find((c) => c.code === country)?.calling ?? null;

// E.164 from a country and a local number. The national trunk prefix (a leading 0) is dropped.
// Returns null for no number, or 'invalid' when the number cannot be written in E.164.
export function composePhone(country: string, local: string): string | null | 'invalid' {
    const digits = local.replace(/[\s\-().]/g, '');
    if (!digits) return null;
    if (digits.startsWith('+')) return /^\+[1-9][0-9]{6,14}$/.test(digits) ? digits : 'invalid';
    const cc = callingCode(country);
    if (!cc || !/^[0-9]+$/.test(digits)) return 'invalid';
    const e164 = `+${cc}${digits.replace(/^0+/, '')}`;
    return /^\+[1-9][0-9]{6,14}$/.test(e164) ? e164 : 'invalid';
}

export function clientBody(f: ClientForm): ClientCreate | 'invalid' {
    const phone = composePhone(f.phone_country, f.phone_local);
    if (phone === 'invalid') return 'invalid';
    const contacts: PartyContactInput[] = f.contact_name.trim()
        ? [{ contact_name: f.contact_name.trim(), phone, email: f.email.trim() || null, is_primary: true }]
        : [];
    const body: ClientCreate = { country_code: f.country_code, contacts };
    if (f.party_code.trim()) body.party_code = f.party_code.trim(); // optional: the server generates it (O-1)
    if (f.name_ar.trim()) body.name_ar = f.name_ar.trim();
    if (f.name_en.trim()) body.name_en = f.name_en.trim();
    if (f.tax_registration_no.trim()) body.tax_registration_no = f.tax_registration_no.trim();
    return body;
}

export interface ProjectForm {
    project_code: string;
    client_party_id: string;
    name: string;
    currency_code: string;
    start_date: string;
    end_date: string;
}
// O-3: required in the contract with no default; the screen pre-fills the company's base currency, and the user can change it
export const initialProjectForm = (company: Pick<Company, 'base_currency_code'>): ProjectForm => ({
    project_code: '',
    client_party_id: '',
    name: '',
    currency_code: company.base_currency_code,
    start_date: '',
    end_date: ''
});

export function projectBody(f: ProjectForm): ProjectCreate {
    const body: ProjectCreate = { client_party_id: f.client_party_id, name: f.name.trim(), currency_code: f.currency_code };
    if (f.project_code.trim()) body.project_code = f.project_code.trim();
    if (f.start_date) body.start_date = f.start_date;
    if (f.end_date) body.end_date = f.end_date;
    return body;
}
