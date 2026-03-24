import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/**
 * POST /api/cadin/persons/[id]/photo
 * Recebe multipart/form-data com o arquivo 'photo' (PNG/JPG).
 * Faz upload para o bucket 'cadin-photos', e salva a URL pública em cadin_persons.photo_url.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id) return NextResponse.json({ error: 'ID faltante' }, { status: 400 });

    const formData = await request.formData();
    const file = formData.get('photo') as File;
    if (!file) {
      return NextResponse.json({ error: 'Nenhuma foto enviada' }, { status: 400 });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Gerar nome único p/ evitar colisão
    const fileExt = file.name.split('.').pop() || 'png';
    const fileName = `${id}-${Date.now()}.${fileExt}`;

    // Converter web File para ArrayBuffer -> Buffer (Next.js Node runtime support)
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Upload
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('cadin-photos')
      .upload(fileName, buffer, {
        contentType: file.type || 'image/png',
        upsert: true,
      });

    if (uploadError) throw uploadError;

    // Gerar URL pública
    const { data: publicUrlData } = supabase.storage
      .from('cadin-photos')
      .getPublicUrl(uploadData.path);

    const photoUrl = publicUrlData.publicUrl;

    // Atualizar registro no banco
    const { error: updateError } = await supabase
      .from('cadin_persons')
      .update({ photo_url: photoUrl })
      .eq('id', id);

    if (updateError) throw updateError;

    return NextResponse.json({ success: true, photo_url: photoUrl });
  } catch (error: any) {
    console.error('Erro ao fazer upload da foto:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
