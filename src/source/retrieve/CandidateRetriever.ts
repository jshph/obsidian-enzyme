export abstract class CandidateRetriever {
	abstract retrieve(parameters: any): Promise<any[]>
}
